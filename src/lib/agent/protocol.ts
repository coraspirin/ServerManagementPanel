import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * panel-agent protokolü — merkez ile ajanın ORTAK sözleşmesi. Saf modül
 * (testlerden import edilir, `server-only` yok).
 *
 * Taşıma: HTTPS (ajanın kendi ürettiği sertifika, merkezde parmak izi
 * sabitlenir) + her istekte HMAC imzası. Paylaşılan sır hiçbir zaman kabloya
 * yazılmaz; imza yöntemi, gövdesi ve zamanıyla isteği bağlar, nonce tekrar
 * oynatmayı engeller.
 */

/**
 * Uyumsuz bir değişiklikte artar; eşleşmeyen ajan "incompatible" sayılır.
 *
 * 2: terminal (exec.*), Docker olayları, helper.call ve sunucu dosya
 * işlemleri eklendi. 1.10.0 ajanı bunları bilmiyor; bağlanıp yarım
 * çalışmak yerine açıkça uyumsuz görünsün.
 */
export const AGENT_PROTOCOL = 2;

export const AGENT_HEADERS = {
  ts: "x-agent-ts",
  nonce: "x-agent-nonce",
  sig: "x-agent-sig",
} as const;

/** İmzanın geçerli sayıldığı saat farkı (saniye). */
export const CLOCK_SKEW_SECONDS = 60;

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function canonical(method: string, path: string, ts: string, nonce: string, body: string): string {
  return [method.toUpperCase(), path, ts, nonce, sha256Hex(body)].join("\n");
}

export function signRequest(
  secret: string,
  input: { method: string; path: string; ts: string; nonce: string; body: string },
): string {
  return createHmac("sha256", secret)
    .update(canonical(input.method, input.path, input.ts, input.nonce, input.body))
    .digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export type VerifyFailure = "missing" | "clock" | "replay" | "signature";

/**
 * İmza doğrulaması. `seen` nonce'u kaydeder ve daha önce görüldüyse false
 * döner — pencere içinde aynı istek ikinci kez kabul edilmez.
 */
export function verifyRequest(
  secret: string,
  input: {
    method: string;
    path: string;
    ts: string | null;
    nonce: string | null;
    sig: string | null;
    body: string;
  },
  now: number,
  seen: (nonce: string) => boolean,
): { ok: true } | { ok: false; reason: VerifyFailure } {
  const { ts, nonce, sig } = input;
  if (!ts || !nonce || !sig || !/^[0-9a-f]{16,64}$/.test(nonce)) return { ok: false, reason: "missing" };
  const stamp = Number(ts);
  if (!Number.isFinite(stamp) || Math.abs(now - stamp) > CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: "clock" };
  }
  const expected = signRequest(secret, { ...input, ts, nonce });
  if (!safeEqualHex(expected, sig)) return { ok: false, reason: "signature" };
  // İmza doğrulandıktan SONRA: sahte isteklerin nonce önbelleğini
  // doldurmasına izin verme.
  if (!seen(nonce)) return { ok: false, reason: "replay" };
  return { ok: true };
}

/**
 * Kayıt kanıtı: ajan, TLS sertifikasının parmak izini sırla imzalar. Arada
 * duran biri kendi sertifikasını sunabilir ama sırrı bilmediği için bu
 * kanıtı üretemez; merkez gördüğü parmak iziyle kanıttakini karşılaştırır.
 */
export function enrollProof(secret: string, nonce: string, fingerprint: string): string {
  return createHmac("sha256", secret).update(`enroll\n${nonce}\n${normalizeFingerprint(fingerprint)}`).digest("hex");
}

export function verifyEnrollProof(secret: string, nonce: string, fingerprint: string, proof: string): boolean {
  return safeEqualHex(enrollProof(secret, nonce, fingerprint), proof);
}

/** "AA:BB:.." ve "aabb.." biçimlerini aynı değere indirger. */
export function normalizeFingerprint(value: string): string {
  return value.replace(/[^0-9a-f]/gi, "").toLowerCase();
}

/**
 * DockerProvider metotlarının ajan üzerinden taşınışı. Adlar `ops.ts`te
 * `keyof DockerProvider` ile doğrulanıyor (bu modül saf kalsın diye burada
 * tip bağımlılığı yok).
 */

/** Değer döndüren Docker metotları. */
export const DOCKER_CALLS = [
  "inspect",
  "list",
  "stats",
  "action",
  "prune",
  "detail",
  "inspectRaw",
  "images",
  "volumes",
  "networks",
  "removeResource",
  "setRestartPolicy",
  "createContainer",
  "renameContainer",
  "removeContainer",
  "connectNetwork",
  "runOnce",
  "runThrowaway",
  "readContainerArchive",
  "writeContainerArchive",
  "imageHistory",
  "inspectImageRaw",
  "inspectVolumeRaw",
  "exportImage",
  "createNetwork",
  "disconnectNetwork",
  "createVolume",
  "tagImage",
  "diskUsage",
] as const;

/** Akış döndüren Docker metotları (`AsyncGenerator`). */
export const DOCKER_STREAMS = ["pullImage", "logs"] as const;

// --- Codec -----------------------------------------------------------------

/**
 * JSON'un taşıyamadığı değerler etiketlenerek taşınır: Buffer (dosya,
 * arşiv), Date ve `undefined` (dizilerde ve dönüş değerinde anlamlı).
 */
type Tagged =
  | { $t: "buf"; v: string }
  | { $t: "date"; v: string }
  | { $t: "undef" };

export function encodeValue(value: unknown): string {
  return JSON.stringify(value === undefined ? { $t: "undef" } : value, function (this: unknown, key, raw) {
    // `toJSON` Buffer ve Date'i dönüştürmeden önceki hâline bakmak için
    // `this[key]` kullanılıyor.
    const original = (this as Record<string, unknown>)[key];
    if (Buffer.isBuffer(original)) return { $t: "buf", v: original.toString("base64") } satisfies Tagged;
    if (original instanceof Date) return { $t: "date", v: original.toISOString() } satisfies Tagged;
    if (original === undefined && Array.isArray(this)) return { $t: "undef" } satisfies Tagged;
    return raw;
  });
}

function revive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === "object") {
    if ("$t" in value) {
      const tagged = value as Tagged;
      if (tagged.$t === "buf") return Buffer.from(tagged.v, "base64");
      if (tagged.$t === "date") return new Date(tagged.v);
      if (tagged.$t === "undef") return undefined;
    }
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) out[key] = revive(inner);
    return out;
  }
  return value;
}

/**
 * JSON.parse'ın reviver'ı KULLANILMIYOR: reviver `undefined` döndürünce dizi
 * elemanını siler ve dizi delikli kalır.
 */
export function decodeValue(text: string): unknown {
  return revive(JSON.parse(text));
}

// --- Mesajlar --------------------------------------------------------------

export type RpcRequest = {
  op: string;
  args: unknown[];
  /** Merkezin bu istek için çözdüğü ayarlar (ajanın kendi DB'si boş). */
  settings: Record<string, unknown>;
};

export type RpcError = { message: string; code?: string };

export type RpcResponse = { ok: true; value: unknown } | { ok: false; error: RpcError };

/** Akış çerçeveleri — NDJSON, satır başına bir tane. */
export type StreamFrame =
  | { t: "d"; d: unknown }
  | { t: "end" }
  | { t: "err"; e: RpcError };

export type AgentHello = {
  protocol: number;
  version: string;
  hostname: string;
  osName: string | null;
  time: number;
  capabilities: { docker: boolean; helper: boolean; hostRoot: boolean; reports: boolean };
};

export type EnrollResponse = { fingerprint: string; proof: string; hello: AgentHello };
