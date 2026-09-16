/**
 * T12 — v1 yanıt zarfı.
 *
 * Hata biçimi iç uçlardan BİLEREK farklı. İç uçlar `{error: "metin"}`
 * döndürüyor ve bu bir ekran için yeterli; bir script ise metni ayrıştırmak
 * zorunda kalmadan dallanabilmeli. Kod sabit, mesaj insan içindir ve
 * değişebilir — istemci koda bakar, mesaja değil.
 */

import { serverT } from "@/lib/i18n/runtime";

export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid_request"
  | "conflict"
  | "rate_limited"
  | "upstream_error"
  | "internal_error";

const STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid_request: 400,
  conflict: 409,
  rate_limited: 429,
  upstream_error: 502,
  internal_error: 500,
};

/** Sürüm bilgisi PAZARLIK İÇİN DEĞİL, bilgi amaçlı. Sürümleme yol segmentiyle. */
const VERSION_HEADER = "X-Panel-Api-Version";
const VERSION = "1";

function baseHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set(VERSION_HEADER, VERSION);
  // Araya giren bir önbelleğin yetkiye bağlı bir gövdeyi saklaması, onu
  // yetkisiz birine servis etmesi demek.
  headers.set("Cache-Control", "no-store");
  return headers;
}

export function apiOk(body: unknown, init: { status?: number; headers?: HeadersInit } = {}): Response {
  return Response.json(body, {
    status: init.status ?? 200,
    headers: baseHeaders(init.headers),
  });
}

/**
 * Hata yanıtı.
 *
 * `message` alanına HAM istek/yanıt gövdesi veya başlık konmaz — `upstream_error`
 * dâhil. Yasak kalıp: `catch (e) { message: JSON.stringify(e) }` — istisna
 * nesnesi `request` taşıyorsa başlık da gelir.
 */
export function apiError(
  code: ApiErrorCode,
  message: string,
  init: { status?: number; headers?: HeadersInit } = {},
): Response {
  return Response.json(
    { error: { code, message } },
    { status: init.status ?? STATUS[code], headers: baseHeaders(init.headers) },
  );
}

/** Düz metin yanıt (container logları). Zarf yok ama başlıklar aynı. */
export function apiText(body: string, init: { status?: number; headers?: HeadersInit } = {}): Response {
  const headers = baseHeaders(init.headers);
  headers.set("Content-Type", "text/plain; charset=utf-8");
  return new Response(body, { status: init.status ?? 200, headers });
}

export function rateLimited(retryAfterSeconds: number): Response {
  return apiError("rate_limited", serverT("apiv1.rateLimited"), {
    headers: { "Retry-After": String(Math.max(retryAfterSeconds, 1)) },
  });
}
