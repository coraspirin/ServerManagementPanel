import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { authLimiter, rateLimitIp, usageLimiter } from "./ratelimit.ts";

/**
 * En kritik test dosyası: `rateLimitIp` bozulursa kimlik denemesi kovası
 * hiçbir şey korumaz — saldırgan her istekte farklı bir X-Forwarded-For
 * gönderip her isteği yeni bir kovaya düşürür. Sınır varmış gibi görünüp
 * hiçbir şey sınırlamayan bir kod, sınırın hiç olmamasından kötü.
 */

function request(headers: Record<string, string>): Request {
  return new Request("https://panel.local/api/v1/system", { headers });
}

describe("rateLimitIp", () => {
  it("Caddy'nin set ettiği X-Real-IP'yi kullanır", () => {
    assert.equal(rateLimitIp(request({ "x-real-ip": "192.168.1.50" })), "192.168.1.50");
  });

  it("X-Real-IP varken uydurma X-Forwarded-For'u YOK SAYAR", () => {
    const ip = rateLimitIp(
      request({ "x-real-ip": "192.168.1.50", "x-forwarded-for": "10.0.0.1, 10.0.0.2" }),
    );
    assert.equal(ip, "192.168.1.50");
  });

  it("X-Real-IP YOKSA X-Forwarded-For'a HİÇ bakmaz — son segmente bile", () => {
    /*
     * Bu testin geçmesi, ölçülmüş bir açığın kapalı kaldığını gösteriyor.
     * Önceki kural "zincirin son segmentine güven" idi; yalnızca önde
     * güvenilir bir proxy olduğunu BİLDİĞİMİZDE doğru. Panele doğrudan
     * ulaşılabiliyorsa zincirin tamamı — sonu dâhil — saldırgan tarafından
     * yazılmıştır. Ölçümde 14 farklı uydurma değer 14 ayrı kovaya düşmüş ve
     * sınır hiç tetiklenmemişti.
     */
    assert.equal(rateLimitIp(request({ "x-forwarded-for": "1.2.3.4, 5.6.7.8, 9.9.9.9" })), "unknown");
    assert.equal(rateLimitIp(request({ "x-forwarded-for": "192.168.1.50" })), "unknown");
  });

  it("uydurma XFF'li farklı istekler AYNI kovaya düşer", () => {
    const first = rateLimitIp(request({ "x-forwarded-for": "10.0.0.1" }));
    const second = rateLimitIp(request({ "x-forwarded-for": "10.0.0.2" }));
    assert.equal(first, second, "farklı kovalara düşerlerse sınır atlatılabilir");
  });

  it("boş X-Real-IP ortak kovaya düşer", () => {
    assert.equal(rateLimitIp(request({ "x-real-ip": "  ", "x-forwarded-for": "1.2.3.4" })), "unknown");
  });

  it("hiçbir başlık yoksa ORTAK anahtara düşer (kapalı tarafa varsayım)", () => {
    assert.equal(rateLimitIp(request({})), "unknown");
  });
});

describe("FixedWindowCounter", () => {
  beforeEach(() => {
    usageLimiter.clear();
    authLimiter.clear();
  });

  it("sınıra kadar izin verir, sonra reddeder", () => {
    const now = Date.now();
    for (let i = 0; i < 3; i += 1) {
      assert.equal(usageLimiter.hit("token-1", 3, now).allowed, true, `${i}. istek geçmeli`);
    }
    const blocked = usageLimiter.hit("token-1", 3, now);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfter > 0, "Retry-After pozitif olmalı");
  });

  it("kovalar anahtar başına ayrı", () => {
    const now = Date.now();
    usageLimiter.hit("token-1", 1, now);
    assert.equal(usageLimiter.hit("token-1", 1, now).allowed, false);
    assert.equal(usageLimiter.hit("token-2", 1, now).allowed, true);
  });

  it("pencere dolunca sayaç sıfırlanır", () => {
    const now = Date.now();
    usageLimiter.hit("token-1", 1, now);
    assert.equal(usageLimiter.hit("token-1", 1, now).allowed, false);
    assert.equal(usageLimiter.hit("token-1", 1, now + 61_000).allowed, true);
  });

  it("reset kovayı boşaltır (test yalıtımı için)", () => {
    const now = Date.now();
    authLimiter.hit("10.0.0.1", 2, now);
    authLimiter.hit("10.0.0.1", 2, now);
    assert.equal(authLimiter.hit("10.0.0.1", 2, now).allowed, false);

    authLimiter.reset("10.0.0.1");
    assert.equal(authLimiter.hit("10.0.0.1", 2, now).allowed, true);
  });

  it("kova KENDİLİĞİNDEN boşalmaz — yalnızca pencere dolunca", () => {
    /*
     * Bu test bir POLİTİKAYI çiviliyor: `guardV1` kimlik denemesi kovasını
     * BAŞARILI bir çözümlemeden sonra SIFIRLAMAZ.
     *
     * Bir dönem sıfırlıyordu; gerekçesi "aynı NAT arkasındaki meşru istemci
     * cezalandırılmasın" idi. Gerekçe geçersizdi: kova yalnızca başarısız
     * yolda okunuyor, meşru istemci ona hiç çarpmıyor. Sıfırlamanın tek
     * gerçek etkisi, elinde bir geçerli anahtar olan birinin her 10 tahminin
     * arasına tek bir geçerli istek sıkıştırarak sınırı sonsuza kadar
     * atlatabilmesiydi (izole örnekte ölçüldü).
     *
     * Buradaki testin koruduğu şey `reset`in var olmaması değil — test
     * yalıtımı için duruyor — sayacın kendi kendine temizlenmemesi.
     */
    const now = Date.now();
    for (let i = 0; i < 3; i += 1) authLimiter.hit("10.0.0.2", 2, now);

    // Pencere içinde kalan her deneme reddedilmeye devam ediyor.
    assert.equal(authLimiter.hit("10.0.0.2", 2, now + 30_000).allowed, false);
    // Ancak pencere dolduğunda açılıyor.
    assert.equal(authLimiter.hit("10.0.0.2", 2, now + 61_000).allowed, true);
  });
});
