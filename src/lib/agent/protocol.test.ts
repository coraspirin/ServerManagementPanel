import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  announceUrl,
  decodeValue,
  encodeValue,
  enrollProof,
  normalizeFingerprint,
  parseAnnounce,
  signRequest,
  verifyEnrollProof,
  verifyRequest,
} from "./protocol.ts";

const SECRET = "s3cr3t-paylasilan";
const NOW = 1_800_000_000;

function signed(overrides: Partial<{ body: string; ts: string; nonce: string; path: string }> = {}) {
  const base = { method: "POST", path: "/api/agent/rpc", ts: String(NOW), nonce: "a1b2c3d4e5f60718", body: '{"op":"x"}' };
  const input = { ...base, ...overrides };
  return { ...input, sig: signRequest(SECRET, input) };
}

const fresh = () => {
  const seen = new Set<string>();
  return (nonce: string) => (seen.has(nonce) ? false : (seen.add(nonce), true));
};

describe("verifyRequest", () => {
  it("geçerli imzayı kabul eder", () => {
    assert.deepEqual(verifyRequest(SECRET, signed(), NOW, fresh()), { ok: true });
  });

  it("değiştirilmiş gövdeyi reddeder", () => {
    const request = { ...signed(), body: '{"op":"y"}' };
    assert.deepEqual(verifyRequest(SECRET, request, NOW, fresh()), { ok: false, reason: "signature" });
  });

  it("başka yola yönlendirilmiş isteği reddeder", () => {
    const request = { ...signed(), path: "/api/agent/stream" };
    assert.deepEqual(verifyRequest(SECRET, request, NOW, fresh()), { ok: false, reason: "signature" });
  });

  it("yanlış sırla imzalanmışı reddeder", () => {
    assert.deepEqual(verifyRequest("baska", signed(), NOW, fresh()), { ok: false, reason: "signature" });
  });

  it("eski zaman damgasını reddeder", () => {
    assert.deepEqual(verifyRequest(SECRET, signed(), NOW + 120, fresh()), { ok: false, reason: "clock" });
  });

  it("aynı isteğin ikinci kez oynatılmasını reddeder", () => {
    const seen = fresh();
    const request = signed();
    assert.deepEqual(verifyRequest(SECRET, request, NOW, seen), { ok: true });
    assert.deepEqual(verifyRequest(SECRET, request, NOW, seen), { ok: false, reason: "replay" });
  });

  it("imzası bozuk istek nonce önbelleğine girmez", () => {
    const seen = fresh();
    const request = signed();
    verifyRequest(SECRET, { ...request, sig: "0".repeat(64) }, NOW, seen);
    assert.deepEqual(verifyRequest(SECRET, request, NOW, seen), { ok: true });
  });

  it("eksik başlıkları reddeder", () => {
    assert.deepEqual(verifyRequest(SECRET, { ...signed(), sig: null }, NOW, fresh()), {
      ok: false,
      reason: "missing",
    });
  });
});

describe("kayıt kanıtı", () => {
  const FP = "AB:CD:EF:01";

  it("aynı parmak izi için doğrulanır, biçim farkı önemsiz", () => {
    const proof = enrollProof(SECRET, "n1", FP);
    assert.equal(verifyEnrollProof(SECRET, "n1", "abcdef01", proof), true);
  });

  it("araya giren sunucunun parmak iziyle doğrulanmaz", () => {
    const proof = enrollProof(SECRET, "n1", FP);
    assert.equal(verifyEnrollProof(SECRET, "n1", "11:22:33:44", proof), false);
  });

  it("başka nonce ile doğrulanmaz", () => {
    const proof = enrollProof(SECRET, "n1", FP);
    assert.equal(verifyEnrollProof(SECRET, "n2", FP, proof), false);
  });

  it("parmak izini normalleştirir", () => {
    assert.equal(normalizeFingerprint("AB:cd:EF"), "abcdef");
  });
});

describe("codec", () => {
  it("Buffer, Date ve undefined gidiş-dönüşte korunur", () => {
    const value = { file: Buffer.from("merhaba"), at: new Date("2026-01-02T03:04:05.000Z"), list: [1, undefined, "x"] };
    const back = decodeValue(encodeValue(value)) as typeof value;
    assert.ok(Buffer.isBuffer(back.file));
    assert.equal(back.file.toString(), "merhaba");
    assert.ok(back.at instanceof Date);
    assert.equal(back.at.toISOString(), "2026-01-02T03:04:05.000Z");
    assert.deepEqual(back.list, [1, undefined, "x"]);
  });

  it("dönüş değeri undefined olabilir", () => {
    assert.equal(decodeValue(encodeValue(undefined)), undefined);
  });

  it("null korunur", () => {
    assert.equal(decodeValue(encodeValue(null)), null);
  });
});

describe("duyuru (Faz B adım 6)", () => {
  const FP = "AA:".repeat(31) + "AA";
  const valid = { address: "192.168.1.20", port: 7443, fingerprint: FP, version: "1.13.1", hostname: "pi", osName: "Debian" };

  it("geçerli gövde ayrıştırılır, adres URL'ye çevrilir", () => {
    const parsed = parseAnnounce(JSON.stringify(valid));
    assert.deepEqual(parsed, valid);
    assert.equal(announceUrl(parsed!), "https://192.168.1.20:7443");
    assert.equal(announceUrl({ address: "fd00::5", port: 7443 }), "https://[fd00::5]:7443");
  });

  it("biçim dışı alanlar reddedilir", () => {
    const bad = [
      { ...valid, port: 0 },
      { ...valid, port: "7443" },
      { ...valid, address: "1.2.3.4/evil" },
      { ...valid, address: "a b" },
      { ...valid, fingerprint: "abc" },
      { ...valid, version: "1.0; rm" },
      { ...valid, hostname: "x\ny" },
      { ...valid, hostname: "" },
    ];
    for (const body of bad) assert.equal(parseAnnounce(JSON.stringify(body)), null, JSON.stringify(body));
    assert.equal(parseAnnounce("[]"), null);
    assert.equal(parseAnnounce("{"), null);
  });

  it("imza yola bağlı: RPC imzası duyuru olarak geçmez", () => {
    const body = JSON.stringify(valid);
    const rpc = signed({ body });
    const asAnnounce = verifyRequest(SECRET, { ...rpc, path: "/api/agent/announce" }, NOW, () => true);
    assert.deepEqual(asAnnounce, { ok: false, reason: "signature" });
    const announce = signed({ body, path: "/api/agent/announce" });
    assert.deepEqual(verifyRequest(SECRET, announce, NOW, () => true), { ok: true });
  });
});
