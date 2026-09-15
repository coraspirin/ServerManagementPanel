/**
 * T12 — hız sınırı ve güvenilir istemci IP'si.
 *
 * TEK-PROCESS VARSAYIMI. Kovalar bellek içi (Map), yeni tablo yok. Panel tek
 * Next standalone process olarak çalışıyor (docker-compose.yml), bu yüzden
 * varsayım bugün doğru. Yatay ölçekleme bu panelin hedefi DEĞİL: dağıtık
 * sayaç için ya Redis ya da her istekte bir SQLite yazımı gerekirdi ve ikisi
 * de sınırın kendisinden pahalı. Bir gün gerekirse yer hazır — `cache`
 * tablosu (migration 008) tam bu iş için var.
 *
 * `npm run dev` altında Next birden fazla worker açabilir; geliştirmede
 * sınırın gevşek davranması beklenen durumdur.
 */

type Bucket = { count: number; resetAt: number };

/** Kovanın anahtarına göre sayaç. Pencere sabit (dakikalık), kayan değil. */
class FixedWindowCounter {
  private readonly buckets = new Map<string, Bucket>();

  /** true = izin verildi. false = sınır aşıldı. */
  hit(key: string, limit: number, now = Date.now()): { allowed: boolean; retryAfter: number } {
    this.sweep(now);

    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + 60_000 });
      return { allowed: true, retryAfter: 0 };
    }

    existing.count += 1;
    if (existing.count > limit) {
      return { allowed: false, retryAfter: Math.ceil((existing.resetAt - now) / 1000) };
    }
    return { allowed: true, retryAfter: 0 };
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  /** Süresi geçmiş kovaları atar; Map'in sınırsız büyümesini engeller. */
  private sweep(now: number): void {
    if (this.buckets.size < 1000) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  /** Yalnızca test için. */
  clear(): void {
    this.buckets.clear();
  }
}

/** Meşru istemcinin paneli boğmasını engeller. Anahtar: token id. */
export const usageLimiter = new FixedWindowCounter();

/**
 * Token tahmin/tarama denemelerini engeller. Anahtar: istemci IP'si.
 *
 * Bu kova ZORUNLU: kullanım kovası `token.id`'ye bakıyor, geçersiz bir
 * token'ın id'si yok — yani onsuz başarısız denemeler HİÇ sayılmaz ve
 * saniyede binlerce `pnl_` denemesi sınırsız olurdu. login.ts'teki kaba
 * kuvvet kilidinin token karşılığı; orada kilit kullanıcı satırında, burada
 * token satırı olmadığı için IP'de.
 */
export const authLimiter = new FixedWindowCounter();

const UNKNOWN_CLIENT = "unknown";

/**
 * Hız sınırı için güvenilir istemci adresi.
 *
 * ⚠️ Bu kural kozmetik değil: IP saldırganın gönderdiği bir başlıktan
 * okunsaydı, her denemede farklı bir değer yazarak her isteği yeni bir kovaya
 * düşürür ve sınır hiç devreye girmezdi. Sınır varmış gibi görünüp hiçbir şey
 * sınırlamayan bir kod, sınırın hiç olmamasından kötüdür.
 *
 * KURAL: TEK kaynak — `X-Real-IP`. Yoksa tek ortak kova.
 *
 * `X-Real-IP`e güvenilebilir çünkü Caddyfile'da `header_up X-Real-IP
 * {remote_host}` ile SET ediliyor (append değil): istemcinin gönderdiği değer
 * ne olursa olsun ezilir ve yerine Caddy'nin kendi soketinde gördüğü adres
 * yazılır.
 *
 * `X-Forwarded-For` BİLEREK HİÇ OKUNMUYOR — "son segmente güven" kuralı
 * ölçüldü ve YANLIŞ çıktı. O kural yalnızca önde güvenilir bir proxy
 * olduğunu BİLDİĞİMİZDE geçerli; Caddy zinciri kendi gördüğü adresi sona
 * eklediği için son segment doğru olur. Ama panele doğrudan ulaşılabiliyorsa
 * zincirin TAMAMI — sonu dâhil — saldırgan tarafından yazılmıştır ve son
 * segment, ilki kadar uydurmadır. Ölçüm: X-Real-IP olmadan her istekte farklı
 * bir `X-Forwarded-For` gönderildiğinde 14 denemenin 14'ü de ayrı kovaya
 * düştü ve sınır hiç tetiklenmedi.
 *
 * Önde Caddy varsa `X-Real-IP` zaten hep var, yani üretimde bu kural hiçbir
 * şey kaybettirmiyor. Yoksa bütün istekler tek kovayı paylaşır: sınır
 * genelleşir ama YOK OLMAZ. Kapalı tarafa düşen varsayım — anormal bir
 * durumda sıkılaşır, gevşemez.
 *
 * `clientIp()` (lib/request.ts) BU İŞ İÇİN KULLANILMIYOR: yedek yolunda
 * `split(",")[0]` ile zincirin ilk segmentini alıyor. Audit kaydı için makul
 * (üretimde X-Real-IP hep dolu, o yol hiç çalışmıyor), ama bir hız sınırı
 * anahtarının uydurulabilir bir yedek yola dayanması kabul edilemez.
 */
export function rateLimitIp(request: Request): string {
  const real = request.headers.get("x-real-ip");
  if (real && real.trim()) return real.trim();
  return UNKNOWN_CLIENT;
}
