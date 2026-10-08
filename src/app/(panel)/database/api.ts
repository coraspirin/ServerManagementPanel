import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

/** JSON uç çağrısı; seçili sunucu başlığını genel fetch sarmalayıcısı ekliyor. */
export async function call(path: string, method: string, body?: unknown) {
  const response = await fetch(path, {
    method,
    headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    // Gövdesiz/HTML yanıt (ör. ters vekil hatası): payload boş kalır.
  }
  return { response, payload };
}

/** Rastgele parola — yeni DB kullanıcısı için öneri. */
export function generatePassword(length = 20): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}
