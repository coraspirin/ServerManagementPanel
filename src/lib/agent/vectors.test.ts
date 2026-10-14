import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { checkDockerApi, prepareDockerApiRequest } from "./docker-api-policy.ts";
import {
  AGENT_HEADERS,
  AGENT_PROTOCOL,
  CLOCK_SKEW_SECONDS,
  decodeValue,
  encodeValue,
  enrollProof,
  normalizeFingerprint,
  sha256Hex,
  signRequest,
  verifyRequest,
} from "./protocol.ts";

/*
  Ortak test vektörleri (protocol/vectors-v3.json) — native (Go) ajan aynı
  dosyayla sınanır. Bu test merkezin uygulamasının dosyayla hâlâ uyuştuğunu
  denetler: protokol değişip dosya yenilenmezse (npm run protocol:vectors)
  burada kırılır, Go tarafı eski sözleşmeyle kalmaz.
*/

const vectors = JSON.parse(
  readFileSync(new URL("../../../protocol/vectors-v3.json", import.meta.url), "utf8"),
) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Dilden bağımsız tarif → JS değeri (bkz. scripts/protocol-vectors.ts). */
function fromDescriptor(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(fromDescriptor);
  if (value && typeof value === "object") {
    const tagged = value as { $bytesHex?: string; $dateIso?: string; $undefined?: boolean };
    if (typeof tagged.$bytesHex === "string") return Buffer.from(tagged.$bytesHex, "hex");
    if (typeof tagged.$dateIso === "string") return new Date(tagged.$dateIso);
    if (tagged.$undefined === true) return undefined;
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, fromDescriptor(inner)]));
  }
  return value;
}

describe("protokol vektörleri (v3)", () => {
  it("sürüm ve sabitler", () => {
    assert.equal(vectors.protocol, AGENT_PROTOCOL);
    assert.deepEqual(vectors.headers, AGENT_HEADERS);
    assert.equal(vectors.clockSkewSeconds, CLOCK_SKEW_SECONDS);
  });

  it("imza", () => {
    for (const entry of vectors.sign) {
      assert.equal(sha256Hex(entry.body), entry.bodySha256, entry.name);
      assert.equal(signRequest(entry.secret, entry), entry.sig, entry.name);
    }
  });

  it("doğrulama", () => {
    for (const entry of vectors.verify) {
      const result = verifyRequest(entry.secret, entry, entry.now, () => true);
      assert.equal(result.ok ? "ok" : result.reason, entry.expect, entry.name);
    }
  });

  it("parmak izi ve kayıt kanıtı", () => {
    for (const entry of vectors.fingerprint) assert.equal(normalizeFingerprint(entry.input), entry.normalized);
    for (const entry of vectors.enroll) assert.equal(enrollProof(entry.secret, entry.nonce, entry.fingerprint), entry.proof);
  });

  it("$t codec'i", () => {
    for (const entry of vectors.codec) {
      const value = fromDescriptor(entry.decoded);
      assert.deepEqual(decodeValue(entry.wire), value, entry.name);
      assert.equal(encodeValue(value), entry.wire, entry.name);
    }
  });

  it("docker.api izin listesi", () => {
    for (const entry of vectors.dockerApi.check) {
      assert.deepEqual(checkDockerApi(entry.method, entry.path), entry.expect, `${entry.method} ${entry.path}`);
    }
  });

  it("docker.api istek hazırlama", () => {
    for (const entry of vectors.dockerApi.prepare) {
      const result = prepareDockerApiRequest(decodeValue(entry.wire), entry.mode);
      const expected = entry.expect.ok ? { ok: true, request: fromDescriptor(entry.expect.request) } : entry.expect;
      assert.deepEqual(result, expected, entry.name);
    }
  });

  it("örnek mesajlar çözülebilir", () => {
    for (const text of [vectors.rpc.request, vectors.rpc.response, vectors.rpc.error, vectors.rpc.streamRequest, ...vectors.rpc.streamFrames]) {
      assert.doesNotThrow(() => decodeValue(text));
    }
    const response = decodeValue(vectors.rpc.response) as { value: { body: Buffer } };
    assert.ok(Buffer.isBuffer(response.value.body));
  });
});
