/**
 * CVE kapısının sözleşme testleri (M3.28).
 *
 * En kritik iddia `daha_kotu` İYİLEŞMEYİ ENGELLEMEZ: mevcut imajda 5 açık
 * varken 3 açıklı yeni imajı engellemek, kullanıcıyı daha kötü bir yerde
 * tutmak olurdu. İkincisi, mevcut imajın taraması YOKSA engellenmemesi —
 * bilinmezliği "kötü" saymak, taranamayan her imajı dondururdu.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { evaluateGate, isGateMode, type VulnCounts } from "./gate.ts";

function say(over: Partial<VulnCounts> = {}): VulnCounts {
  return { critical: 0, high: 0, medium: 0, low: 0, ...over };
}

describe("evaluateGate — kapali", () => {
  it("kritik açık olsa bile ENGELLEMEZ ama sayıyı söyler", () => {
    const sonuc = evaluateGate("kapali", say({ critical: 9 }), null);
    assert.equal(sonuc.allowed, true);
    assert.match(sonuc.reason, /9 kritik/);
  });
});

describe("evaluateGate — kritik", () => {
  it("kritik açık varsa ENGELLER", () => {
    assert.equal(evaluateGate("kritik", say({ critical: 1 }), null).allowed, false);
  });

  it("yalnızca yüksek açık varsa engellemez", () => {
    assert.equal(evaluateGate("kritik", say({ high: 12 }), null).allowed, true);
  });
});

describe("evaluateGate — kritik_yuksek", () => {
  it("yüksek açık da ENGELLER", () => {
    assert.equal(evaluateGate("kritik_yuksek", say({ high: 1 }), null).allowed, false);
  });

  it("orta ve düşük engellemez", () => {
    assert.equal(
      evaluateGate("kritik_yuksek", say({ medium: 30, low: 50 }), null).allowed,
      true,
    );
  });
});

describe("evaluateGate — daha_kotu", () => {
  it("İYİLEŞMEYİ ENGELLEMEZ", () => {
    // Mevcutta 5, yenide 3 → geçmeli. Diğer ölçütler burada engellerdi ve
    // kullanıcıyı daha açıklı imajda tutardı.
    const sonuc = evaluateGate("daha_kotu", say({ critical: 3 }), say({ critical: 5 }));
    assert.equal(sonuc.allowed, true);
    assert.match(sonuc.reason, /İyileşme/);
  });

  it("GERİLEMEYİ ENGELLER", () => {
    const sonuc = evaluateGate("daha_kotu", say({ critical: 7 }), say({ critical: 5 }));
    assert.equal(sonuc.allowed, false);
    assert.match(sonuc.reason, /daha fazla açık/);
  });

  it("eşitlikte geçer", () => {
    assert.equal(evaluateGate("daha_kotu", say({ high: 2 }), say({ high: 2 })).allowed, true);
  });

  it("seviye dağılımı değişse de TOPLAMA bakar", () => {
    // 1 kritik ↔ 1 düşük: toplam aynı, geçiyor. Seviyeye göre karar vermek
    // "daha kötü" ölçütünün işi değil; onu isteyen `kritik` seçer.
    const sonuc = evaluateGate("daha_kotu", say({ critical: 1 }), say({ low: 1 }));
    assert.equal(sonuc.allowed, true);
  });

  it("mevcut imajın taraması YOKSA engellemez", () => {
    const sonuc = evaluateGate("daha_kotu", say({ critical: 4 }), null);
    assert.equal(sonuc.allowed, true);
    assert.match(sonuc.reason, /karşılaştırma yapılamadı/);
  });

  it("iki taraf da temizse geçer", () => {
    const sonuc = evaluateGate("daha_kotu", say(), say());
    assert.equal(sonuc.allowed, true);
    assert.match(sonuc.reason, /açık yok/);
  });
});

describe("isGateMode", () => {
  it("geçerli ölçütleri tanır", () => {
    assert.equal(isGateMode("daha_kotu"), true);
    assert.equal(isGateMode("kapali"), true);
  });

  it("bilinmeyen değeri REDDEDER", () => {
    assert.equal(isGateMode("her_sey"), false);
    assert.equal(isGateMode(""), false);
  });
});
