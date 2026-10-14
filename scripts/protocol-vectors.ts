/**
 * panel-agent protokol test vektörlerini üretir → `protocol/vectors-v3.json`.
 *
 *   npm run protocol:vectors
 *
 * Vektörler merkezin GERÇEK uygulamasından (src/lib/agent/protocol.ts,
 * docker-api-policy.ts) üretilir; native (Go) ajan kendi uygulamasını aynı
 * dosyayla sınar. `src/lib/agent/vectors.test.ts` TS tarafının dosyayla hâlâ
 * uyuştuğunu denetler — protokol değişip dosya yenilenmezse test kırılır.
 *
 * Belirlenimci: sabit sırlar, nonce'lar ve zaman damgaları. Yeniden
 * üretmek aynı dosyayı vermeli (fark varsa protokol değişmiştir).
 */
import { writeFileSync } from "node:fs";
import {
  AGENT_HEADERS,
  AGENT_PROTOCOL,
  CLOCK_SKEW_SECONDS,
  DOCKER_API_OP,
  DOCKER_API_STREAM_OP,
  encodeValue,
  enrollProof,
  normalizeFingerprint,
  sha256Hex,
  signRequest,
  verifyRequest,
} from "../src/lib/agent/protocol.ts";
import { checkDockerApi, prepareDockerApiRequest } from "../src/lib/agent/docker-api-policy.ts";

const SECRET = "vektor-paylasilan-sir-0123456789abcdef0123456789abcdef";
const TS = "1800000000";

/**
 * Codec değerlerinin dilden bağımsız tarifi: Go testi `decoded`'ı kendi
 * türlerine çevirir. `{"$bytesHex"}` = bayt dizisi, `{"$dateIso"}` = zaman,
 * `{"$undefined": true}` = tanımsız (JSON null'dan FARKLI).
 */
type Descriptor = unknown;

function describe(value: unknown): Descriptor {
  if (value === undefined) return { $undefined: true };
  if (Buffer.isBuffer(value)) return { $bytesHex: value.toString("hex") };
  if (value instanceof Date) return { $dateIso: value.toISOString() };
  if (Array.isArray(value)) return value.map(describe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, describe(inner)]));
  }
  return value;
}

const signCases = [
  { name: "rpc", method: "POST", path: "/api/agent/rpc", nonce: "a1b2c3d4e5f60718a1b2c3d4e5f60718", body: '{"op":"agent.hello","args":[],"settings":{}}' },
  { name: "stream", method: "POST", path: "/api/agent/stream", nonce: "00112233445566778899aabbccddeeff", body: '{"op":"docker.apiStream","args":[{"method":"GET","path":"/events"}],"settings":{}}' },
  { name: "empty-body", method: "POST", path: "/api/agent/enroll", nonce: "ffeeddccbbaa99887766554433221100", body: "" },
  { name: "unicode-body", method: "post", path: "/api/agent/rpc", nonce: "0123456789abcdef", body: '{"op":"files.read","args":["/srv/şarkı ğüşıöç.txt"],"settings":{}}' },
].map((input) => ({
  ...input,
  secret: SECRET,
  ts: TS,
  bodySha256: sha256Hex(input.body),
  canonical: [input.method.toUpperCase(), input.path, TS, input.nonce, sha256Hex(input.body)].join("\n"),
  sig: signRequest(SECRET, { ...input, ts: TS }),
}));

const base = signCases[0];
const now = Number(TS);
const verifyCases = [
  { name: "ok", input: base, now },
  { name: "skew-inside", input: base, now: now + CLOCK_SKEW_SECONDS },
  { name: "skew-outside", input: base, now: now + CLOCK_SKEW_SECONDS + 1 },
  { name: "tampered-body", input: { ...base, body: base.body.replace("hello", "image") }, now },
  { name: "other-path", input: { ...base, path: "/api/agent/stream" }, now },
  { name: "wrong-secret", input: base, now, secret: "baska-bir-sir" },
  { name: "bad-nonce", input: { ...base, nonce: "xyz" }, now },
  { name: "missing-sig", input: { ...base, sig: "" }, now },
].map((entry) => {
  const secret = entry.secret ?? SECRET;
  const input = { method: entry.input.method, path: entry.input.path, ts: entry.input.ts, nonce: entry.input.nonce, sig: entry.input.sig, body: entry.input.body };
  const result = verifyRequest(secret, input, entry.now, () => true);
  return { name: entry.name, secret, ...input, now: entry.now, expect: result.ok ? "ok" : result.reason };
});

const fingerprints = [
  "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89",
  "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  " Ab-Cd ef ",
].map((input) => ({ input, normalized: normalizeFingerprint(input) }));

const enroll = [
  { nonce: "0f1e2d3c4b5a69788796a5b4c3d2e1f0", fingerprint: fingerprints[0].input },
].map((entry) => ({ secret: SECRET, ...entry, proof: enrollProof(SECRET, entry.nonce, entry.fingerprint) }));

const codecValues: { name: string; value: unknown }[] = [
  { name: "plain", value: { a: 1, b: "iki", c: [true, null] } },
  { name: "buffer", value: Buffer.from("merhaba \u0000ÿ dünya", "utf8") },
  { name: "nested-buffer", value: { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from('{"Id":"abc"}') } },
  { name: "date", value: new Date("2026-10-13T12:34:56.789Z") },
  { name: "undefined-top", value: undefined },
  { name: "undefined-in-array", value: [1, undefined, 3] },
  { name: "undefined-in-object-dropped", value: { a: 1, b: undefined } },
  { name: "empty-buffer", value: Buffer.alloc(0) },
];
const codec = codecValues.map(({ name, value }) => {
  const wire = encodeValue(value);
  // Nesnedeki `undefined` alan JSON'da hiç yazılmaz; çözülen değer onsuz.
  return { name, wire, decoded: decodeForDescriptor(wire) };
});

function decodeForDescriptor(wire: string): Descriptor {
  // decodeValue ile aynı kural (protocol.ts revive), tarif biçiminde.
  const revive = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(revive);
    if (value && typeof value === "object") {
      const tagged = value as { $t?: string; v?: string };
      if (tagged.$t === "buf") return { $bytesHex: Buffer.from(tagged.v ?? "", "base64").toString("hex") };
      if (tagged.$t === "date") return { $dateIso: tagged.v };
      if (tagged.$t === "undef") return { $undefined: true };
      return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, revive(inner)]));
    }
    return value;
  };
  return revive(JSON.parse(wire));
}

const checkCases: [string, string][] = [
  ["GET", "/_ping"],
  ["GET", "/v1.43/containers/json?all=1"],
  ["GET", "/containers/json?all=1"],
  ["POST", "/containers/create?name=web"],
  ["GET", "/containers/abc123/json"],
  ["GET", "/containers/%2Fweb/json"],
  ["GET", "/containers/abc123/logs?stdout=1&stderr=1&follow=1"],
  ["POST", "/containers/abc123/restart"],
  ["DELETE", "/containers/abc123?force=1&v=1"],
  ["PUT", "/containers/abc123/archive?path=%2Fetc"],
  ["POST", "/containers/abc123/attach"],
  ["GET", "/containers/abc123/export"],
  ["GET", "/images/ghcr.io%2Fcoraspirin%2Fservermanagementpanel%3A1.13.0/json"],
  ["GET", "/images/sha256%3Aabc/history"],
  ["POST", "/images/create?fromImage=nginx&tag=latest"],
  ["POST", "/images/nginx%3Alatest/tag?repo=x&tag=y"],
  ["DELETE", "/images/nginx%3Alatest?force=0"],
  ["POST", "/images/load"],
  ["GET", "/images/search?term=x"],
  ["POST", "/images/nginx/push"],
  ["GET", "/images/get?names=nginx"],
  ["GET", "/volumes"],
  ["DELETE", "/volumes/data_db"],
  ["POST", "/volumes/create"],
  ["POST", "/networks/net1/connect"],
  ["POST", "/exec/e1/start"],
  ["POST", "/exec/e1/resize?h=24&w=80"],
  ["GET", "/events?filters=%7B%22type%22%3A%5B%22container%22%5D%7D"],
  ["GET", "/system/df"],
  ["POST", "/build/prune"],
  ["POST", "/build"],
  ["GET", "/swarm"],
  ["GET", "/secrets"],
  ["GET", "/plugins"],
  ["POST", "/session"],
  ["GET", "/services"],
  ["GET", "/nodes"],
  ["POST", "/commit?container=abc"],
  ["GET", "/info"],
  ["GET", "/containers/../swarm"],
  ["GET", "/containers/%2e%2e/json"],
  ["GET", "/containers/abc//json"],
  ["GET", "/containers/abc/json\r\nX: y"],
  ["GET", "/containers/abc/json#x"],
  ["GET", "containers/json"],
  ["PATCH", "/containers/json"],
  ["OPTIONS", "/_ping"],
];
const check = checkCases.map(([method, path]) => ({ method, path, expect: checkDockerApi(method, path) }));

const prepareInputs: { name: string; mode: "call" | "stream"; raw: unknown }[] = [
  { name: "json-body", mode: "call", raw: { method: "POST", path: "/containers/create?name=x", headers: { "Content-Type": "application/json", Connection: "Upgrade", Upgrade: "tcp", "X-Registry-Auth": "e30=" }, body: Buffer.from('{"Image":"nginx"}'), timeoutMs: 30000 } },
  { name: "default-timeout", mode: "call", raw: { method: "GET", path: "/containers/json" } },
  { name: "timeout-clamped", mode: "call", raw: { method: "POST", path: "/containers/abc/wait", timeoutMs: 999999999 } },
  { name: "stream-no-timeout", mode: "stream", raw: { method: "GET", path: "/events", timeoutMs: 5000 } },
  { name: "denied", mode: "call", raw: { method: "GET", path: "/swarm" } },
  { name: "bad-shape", mode: "call", raw: { method: 1, path: "/_ping" } },
  { name: "body-not-bytes", mode: "call", raw: { method: "POST", path: "/containers/create", body: "metin" } },
  { name: "header-injection", mode: "call", raw: { method: "GET", path: "/_ping", headers: { "content-type": "a\r\nb: c" } } },
];
const prepare = prepareInputs.map(({ name, mode, raw }) => {
  const result = prepareDockerApiRequest(raw, mode);
  return { name, mode, wire: encodeValue(raw), expect: result.ok ? { ok: true, request: describe(result.request) } : result };
});

const rpcExample = {
  request: encodeValue({
    op: DOCKER_API_OP,
    args: [{ method: "GET", path: "/containers/json?all=1", timeoutMs: 5000 }],
    settings: {},
  }),
  response: encodeValue({
    ok: true,
    value: { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from("[]") },
  }),
  error: encodeValue({ ok: false, error: { message: "docker-api-denied:denied", code: "docker-api-denied" } }),
  streamRequest: encodeValue({ op: DOCKER_API_STREAM_OP, args: [{ method: "GET", path: "/events" }], settings: {} }),
  streamFrames: [
    encodeValue({ t: "d", d: { status: 200, headers: { "content-type": "application/json" } } }),
    encodeValue({ t: "d", d: Buffer.from('{"Type":"container","Action":"start"}\n') }),
    encodeValue({ t: "end" }),
  ],
  streamError: encodeValue({ t: "err", e: { message: "boom" } }),
};

const vectors = {
  $comment:
    "panel-agent protokol v3 test vektörleri. ÜRETİLİR: npm run protocol:vectors (scripts/protocol-vectors.ts). Elle düzenleme.",
  protocol: AGENT_PROTOCOL,
  headers: AGENT_HEADERS,
  clockSkewSeconds: CLOCK_SKEW_SECONDS,
  sign: signCases,
  verify: verifyCases,
  fingerprint: fingerprints,
  enroll,
  codec,
  dockerApi: { check, prepare },
  rpc: rpcExample,
};

const target = new URL("../protocol/vectors-v3.json", import.meta.url);
writeFileSync(target, `${JSON.stringify(vectors, null, 2)}\n`);
console.log(`yazıldı: ${target.pathname}`); // i18n-ignore — geliştirici aracı
