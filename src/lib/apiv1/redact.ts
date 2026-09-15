/**
 * T12 — başlık gizleme.
 *
 * Bir bearer token, parolanın aksine TEK BAŞINA yeterli bir kimlik: kopyalayan
 * kullanır. Kural tek cümlede: `Authorization` başlığının değeri, uygulamanın
 * ürettiği hiçbir metne girmez.
 *
 * Bu modül `server-only` DEĞİL — saf fonksiyon, testten de çağrılıyor.
 */

const SECRET_HEADERS = new Set(["authorization", "cookie", "set-cookie", "x-csrf-token"]);

export const REDACTED = "[gizlendi]";

/**
 * Log'a yazılabilir başlık haritası.
 *
 * Karşılaştırma küçük harfe indirilerek yapılır: `Authorization` ile
 * `authorization` aynı başlıktır ve birini kaçırmak diğerini gizlemeyi
 * anlamsız kılardı.
 */
export function redactHeaders(headers: Headers): Record<string, string> {
  const safe: Record<string, string> = {};
  headers.forEach((value, key) => {
    safe[key] = SECRET_HEADERS.has(key.toLowerCase()) ? REDACTED : value;
  });
  return safe;
}

/**
 * Serbest metinden anahtar benzeri dizileri temizler.
 *
 * `redactHeaders` yalnızca Headers nesnesini kapsıyor; bir anahtar hata
 * mesajına ya da sorgu dizesine de düşebilir (örn. istemci onu yanlışlıkla
 * `?token=` olarak göndermişse). Bu, son savunma hattı — birincil kural hâlâ
 * "değeri hiç metne koyma".
 */
export function redactText(text: string): string {
  return text.replace(/pnl_[A-Za-z0-9_-]{8,}/g, REDACTED);
}

/**
 * Audit kaydına yazılacak aktör etiketi.
 *
 * Anahtarın ADI ve ÖNEKİ yazılır, değeri asla. Önek zaten listede tanınmak
 * için var ve tek başına kullanılamaz; sayesinde denetim ekranında panelden
 * yapılan işlem ile token'dan yapılan ayırt edilebiliyor.
 */
export function tokenAuditTag(tokenName: string, prefix: string): string {
  return `[token:${tokenName} prefix:${prefix}]`;
}
