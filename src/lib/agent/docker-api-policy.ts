/**
 * `docker.api` tüneli — ajanın docker.sock'a İLETECEĞİ istekler (kararlar.md
 * K2). Saf modül: Node ajanı bunu doğrudan kullanır, native (Go) ajan aynı
 * kuralları `protocol/vectors-v3.json` test vektörleriyle sınar.
 *
 * Merkez Docker'ın ham Engine API'sini konuşur (şekillendirme merkezde,
 * `docker.live.ts`); ajan yalnızca izinli yöntem + yol çiftlerini geçirir.
 * Liste KAPALI: yazılmayan her şey (swarm, secrets, plugins, session,
 * services, nodes, configs, build, commit, attach, image load/push…) ret.
 *
 * Kurallar panelin bugün kullandığı uçları kapsar; yeni bir Docker çağrısı
 * eklenince buraya da satır eklenir (bkz. _Claude/tarifler.md).
 */

export type DockerApiMethod = "GET" | "HEAD" | "POST" | "PUT" | "DELETE";

/** Container/exec/ağ/volume kimliği ya da adı — düz eğik çizgi içermez (yüzde kodlu olabilir). */
const ID = "(?:[A-Za-z0-9_.:@+-]|%[0-9A-Fa-f]{2})+";
/** İmaj referansı — yüzde kodlu ya da düz eğik çizgi içerebilir (`ghcr.io/a/b:1`). */
const IMAGE = "(?:[A-Za-z0-9_.:@+-]|%[0-9A-Fa-f]{2}|/)+";

type Rule = { methods: readonly DockerApiMethod[]; pattern: RegExp };

const rule = (methods: readonly DockerApiMethod[], source: string): Rule => ({
  methods,
  pattern: new RegExp(`^${source}$`),
});

const RULES: readonly Rule[] = [
  rule(["GET", "HEAD"], "/_ping"),
  rule(["GET"], "/version"),
  // Container'lar
  rule(["GET"], "/containers/json"),
  rule(["POST"], "/containers/(?:create|prune)"),
  rule(["GET"], `/containers/${ID}/(?:json|logs|stats|top|changes)`),
  rule(["GET", "HEAD", "PUT"], `/containers/${ID}/archive`),
  rule(["POST"], `/containers/${ID}/(?:start|stop|restart|kill|pause|unpause|rename|update|wait|exec|resize)`),
  rule(["DELETE"], `/containers/${ID}`),
  // İmajlar — `load`, `search`, `push`, toplu `get` yok
  rule(["GET"], "/images/json"),
  rule(["POST"], "/images/(?:create|prune)"),
  rule(["GET"], `/images/(?!(?:json|create|prune|load|search|get)(?:/|$))${IMAGE}/(?:json|history|get)`),
  rule(["POST"], `/images/(?!(?:json|create|prune|load|search|get)(?:/|$))${IMAGE}/tag`),
  rule(["DELETE"], `/images/(?!(?:json|create|prune|load|search|get)(?:/|$))${IMAGE}`),
  // Volume'ler
  rule(["GET"], "/volumes"),
  rule(["POST"], "/volumes/(?:create|prune)"),
  rule(["GET", "DELETE"], `/volumes/(?!(?:create|prune)$)${ID}`),
  // Ağlar
  rule(["GET"], "/networks"),
  rule(["POST"], "/networks/(?:create|prune)"),
  rule(["GET", "DELETE"], `/networks/(?!(?:create|prune)$)${ID}`),
  rule(["POST"], `/networks/${ID}/(?:connect|disconnect)`),
  // Exec — etkileşimli (hijack) oturum tünelden geçmez, `exec.*` op'ları ayrı
  rule(["POST"], `/exec/${ID}/(?:start|resize)`),
  rule(["GET"], `/exec/${ID}/json`),
  // Olaylar, disk kullanımı, derleme önbelleği temizliği
  rule(["GET"], "/events"),
  rule(["GET"], "/system/df"),
  rule(["POST"], "/build/prune"),
];

/** İsteğe eklenebilecek başlıklar (küçük harf). Upgrade/Connection YOK: hijack kapalı. */
export const DOCKER_API_HEADERS: readonly string[] = ["content-type"];

/** Tek istekte ajana gönderilebilecek en büyük gövde (arşiv yükleme). */
export const DOCKER_API_MAX_BODY = 256 * 1024 * 1024;

/** Ara bellekli istekte izin verilen en uzun süre (geçici container `wait`'i saatler sürebilir). */
export const DOCKER_API_MAX_TIMEOUT_MS = 6 * 60 * 60 * 1000;

export type DockerApiDecision =
  | { ok: true; method: DockerApiMethod; path: string }
  | { ok: false; reason: "method" | "path" | "denied" };

const METHODS: readonly string[] = ["GET", "HEAD", "POST", "PUT", "DELETE"];

/**
 * Yöntem + yol (sorgu dahil) izinli mi? İzinliyse sürüm öneki (`/v1.43`)
 * atılmış, Docker'a gönderilecek yolu döner.
 */
export function checkDockerApi(method: string, rawPath: string): DockerApiDecision {
  const upper = method.toUpperCase();
  if (!METHODS.includes(upper)) return { ok: false, reason: "method" };

  // Kontrol karakteri, parça (#), boşluk, ters eğik çizgi: istek bölme / yol
  // karıştırma denemesi.
  if (!rawPath.startsWith("/") || /[\u0000- \u007f#\\]/.test(rawPath)) {
    return { ok: false, reason: "path" };
  }

  const queryAt = rawPath.indexOf("?");
  let pathname = queryAt === -1 ? rawPath : rawPath.slice(0, queryAt);
  const query = queryAt === -1 ? "" : rawPath.slice(queryAt);
  pathname = pathname.replace(/^\/v\d+\.\d+(?=\/)/, "");

  // Nokta bölümleri hem düz hem yüzde kodlu biçimde reddedilir: Docker
  // yolu çözerken `%2e%2e`'yi `..` olarak görebilir.
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { ok: false, reason: "path" };
  }
  if (pathname.includes("//") || /(?:^|\/)\.{1,2}(?:\/|$)/.test(decoded)) {
    return { ok: false, reason: "path" };
  }

  const allowed = RULES.some(
    (entry) => entry.methods.includes(upper as DockerApiMethod) && entry.pattern.test(pathname),
  );
  if (!allowed) return { ok: false, reason: "denied" };
  return { ok: true, method: upper as DockerApiMethod, path: pathname + query };
}

/** İzinli başlıkları süzer (anahtarlar küçük harfe). */
export function filterDockerApiHeaders(headers: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    const name = key.toLowerCase();
    if (DOCKER_API_HEADERS.includes(name) && typeof value === "string" && !/[\r\n]/.test(value)) {
      out[name] = value;
    }
  }
  return out;
}

export type PreparedDockerApiRequest = {
  method: DockerApiMethod;
  path: string;
  headers: Record<string, string>;
  body?: Buffer;
  /** 0 = sınırsız (yalnız akış). */
  timeoutMs: number;
};

export type PrepareFailure = "shape" | "method" | "path" | "denied" | "body";

/**
 * Ağdan gelen `DockerApiRequest`'i doğrular: biçim, yöntem + yol kuralı,
 * başlık süzgeci, gövde sınırı, süre. Ajan Docker'a YALNIZCA bunun
 * döndürdüğünü gönderir. `mode: "stream"` süre sınırı koymaz (log/olay
 * akışı saatlerce açık kalır; kapanış merkezin bağlantıyı bırakması).
 */
export function prepareDockerApiRequest(
  raw: unknown,
  mode: "call" | "stream",
): { ok: true; request: PreparedDockerApiRequest } | { ok: false; reason: PrepareFailure } {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "shape" };
  const input = raw as Record<string, unknown>;
  if (typeof input.method !== "string" || typeof input.path !== "string") return { ok: false, reason: "shape" };

  const decision = checkDockerApi(input.method, input.path);
  if (!decision.ok) return { ok: false, reason: decision.reason };

  let body: Buffer | undefined;
  if (input.body !== undefined && input.body !== null) {
    if (!Buffer.isBuffer(input.body)) return { ok: false, reason: "shape" };
    if (input.body.length > DOCKER_API_MAX_BODY) return { ok: false, reason: "body" };
    body = input.body;
  }

  const requested = Number(input.timeoutMs);
  const timeoutMs =
    mode === "stream"
      ? 0
      : Number.isFinite(requested) && requested > 0
        ? Math.min(requested, DOCKER_API_MAX_TIMEOUT_MS)
        : DOCKER_API_MAX_TIMEOUT_MS;

  return {
    ok: true,
    request: {
      method: decision.method,
      path: decision.path,
      headers: filterDockerApiHeaders(input.headers as Record<string, unknown> | undefined),
      ...(body ? { body } : {}),
      timeoutMs,
    },
  };
}
