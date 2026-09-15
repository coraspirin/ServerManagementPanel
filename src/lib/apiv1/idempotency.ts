import { createHmac } from "node:crypto";

/**
 * T12 — `Idempotency-Key` ile tekrar koruması.
 *
 * SORUN: `host/power`, `host/compose` ve `containers/{id}/update` doğası
 * gereği idempotent DEĞİL. Ağ zaman aşımında istemci — n8n'in "retry on fail"
 * düğümü, HA'nın otomasyonu, `curl --retry` — isteği tekrarlar; ilk komut
 * aslında ulaşmış ve çalışmışsa ikincisi art arda İKİNCİ BİR KOMUT olur.
 *
 * ÇÖZÜM YENİ BİR MEKANİZMA DEĞİL. `host-helper/PROTOCOL.md` zaten her isteğin
 * `id`'sini tutuyor ve son 5 dakikada görülmüş bir `id`'yi reddediyor. Helper
 * payload'ının id'si anahtardan TÜRETİLİYOR; böylece panel süreci yeniden
 * başlayıp bellekteki eşleme kaybolsa bile ikinci istek host tarafında
 * reddedilir — garanti panelin belleğine değil, en güvenilir katmana dayanır.
 *
 * OPT-IN: başlık göndermeyen istemci için garanti yoktur ve `docs/API.md` bunu
 * açıkça yazar. Sebebi anahtarı İSTEMCİNİN üretmesi gerekmesi — sunucunun
 * uydurabileceği bir anahtar, "aynı istek" ile "benzer istek"i ayırt edemezdi.
 */

/**
 * Anahtar biçimi sınırlı — yoksa bellek doldurma vektörü.
 *
 * Hız sınırı kovalarının anahtarları Caddy'den ve veritabanından geliyor,
 * sayıları doğal olarak sınırlı. Bu Map'in anahtarını ise İSTEMCİ uyduruyor:
 * her istekte yeni bir anahtar gönderen bir istemci Map'i sınırsız büyütürdü.
 * Hız sınırı bunu tek başına kapatmaz — 120 istek/dk da dakikada 120 yeni
 * anahtar demek.
 */
const KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const MAX_ENTRIES = 500;

export function isValidKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

type Entry = { status: number; body: string; storedAt: number };

const cache = new Map<string, Entry>();

/**
 * Pencere ayardan gelir; helper'ın tekrar penceresiyle AYNI olmalı.
 *
 * `now` enjekte edilebilir: sahte zamanlayıcı kurmadan süre dolmasını test
 * edebilmek için (FixedWindowCounter ile aynı kalıp). `<=` kullanılıyor —
 * tam pencerenin sonundaki bir kayıt artık geçerli değil.
 */
function sweep(windowSeconds: number, now: number): void {
  const cutoff = now - windowSeconds * 1000;
  for (const [key, entry] of cache) {
    if (entry.storedAt <= cutoff) cache.delete(key);
  }

  // LRU: Map ekleme sırasını koruyor, en eski baştan düşer.
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/**
 * Anahtar kullanıcıya göre ayrılıyor: iki farklı istemcinin aynı anahtarı
 * seçmesi (`"gece-bakim"` gibi tahmin edilebilir bir ad) birbirinin yanıtını
 * görmesine yol açmamalı.
 */
function scoped(userId: number, key: string): string {
  return `${userId}:${key}`;
}

export function recall(
  userId: number,
  key: string,
  windowSeconds: number,
  now = Date.now(),
): { status: number; body: string } | null {
  sweep(windowSeconds, now);
  const entry = cache.get(scoped(userId, key));
  return entry ? { status: entry.status, body: entry.body } : null;
}

export function remember(
  userId: number,
  key: string,
  response: { status: number; body: string },
  windowSeconds: number,
  now = Date.now(),
): void {
  cache.set(scoped(userId, key), {
    status: response.status,
    body: response.body,
    storedAt: now,
  });
  sweep(windowSeconds, now);
}

/**
 * Helper istek kimliği — anahtardan TÜRETİLİR, rastgele değil.
 *
 * Helper 16 baytlık hex bekliyor (`PROTOCOL.md`). Aynı anahtar her zaman aynı
 * id'yi üretir, dolayısıyla helper'ın kendi tekrar penceresi ikinci isteği
 * reddeder — panelin belleği kaybolsa bile.
 *
 * HMAC kullanılıyor, düz hash değil: id'ler soket üzerinden gidiyor ve
 * anahtarın kendisi (kullanıcının seçtiği, tahmin edilebilir olabilecek bir
 * ad) geriye çıkarılabilmemeli.
 */
export function helperRequestId(key: string, secret: string): string {
  return createHmac("sha256", secret).update(`idem:${key}`).digest("hex").slice(0, 32);
}

/** Yalnızca test için. */
export function clearIdempotency(): void {
  cache.clear();
}
