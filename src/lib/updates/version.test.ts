/**
 * Sürüm etiketi karşılaştırmasının sözleşme testleri (M3.29).
 *
 * En kritik iddia LEZZET SÜZGECİ: `1.2-alpine` kullanan birine bare `1.5`
 * önermek, taban imajı sessizce değiştirmesini istemek olur — bu bir sürüm
 * yükseltmesi değil, başka bir imaja geçiş. İkincisi, ayrıştırılamayan
 * etiketlerin (`latest`, `stable`) sessizce ATLANMASI, hata vermemesi.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { bumpOf, compareVersions, parseTag, suggestUpgrade } from "./version.ts";

const AYARLAR = { maxBump: "major" as const, matchFlavor: false, includePrerelease: false };

function ayr(tag: string) {
  const parsed = parseTag(tag);
  assert.ok(parsed, `${tag} ayrıştırılamadı`);
  return parsed;
}

describe("parseTag", () => {
  it("SemVer'i parçalar", () => {
    assert.deepEqual(ayr("1.2.3").parts, [1, 2, 3]);
  });

  it("CalVer'i aynı kalıpla okur", () => {
    assert.deepEqual(ayr("2024.12.5").parts, [2024, 12, 5]);
  });

  it("baştaki v'yi yok sayar", () => {
    assert.deepEqual(ayr("v1.2.3").parts, [1, 2, 3]);
  });

  it("tek sayılı etiketi sürüm sayar — mariadb:11 gibi", () => {
    assert.deepEqual(ayr("11").parts, [11]);
  });

  it("lezzeti ayırır", () => {
    assert.equal(ayr("1.2-alpine").flavor, "alpine");
    assert.equal(ayr("1.2").flavor, "");
    assert.equal(ayr("10.11-jammy").flavor, "jammy");
  });

  it("ön sürüm ekini LEZZETE karıştırmaz", () => {
    // Karıştırılırsa rc etiketli imajın lezzeti "rc1" sanılır ve lezzet
    // süzgeci hiçbir öneri üretemez.
    const parsed = ayr("1.5.0-rc1-alpine");
    assert.equal(parsed.flavor, "alpine");
    assert.deepEqual(parsed.pre, ["rc", "1"]);
  });

  it("ön sürümü tanır", () => {
    assert.equal(ayr("1.5.0-rc1").prerelease, true);
    assert.equal(ayr("2.0.0-beta.2").prerelease, true);
    assert.equal(ayr("1.5.0").prerelease, false);
  });

  it("alpine'ı ön sürüm SANMAZ", () => {
    // "alpha" ile "alpine" karışırsa her alpine etiketi elenirdi.
    assert.equal(ayr("1.2-alpine").prerelease, false);
  });

  it("HAREKETLİ etiketleri reddeder", () => {
    // Bunlarda "daha yeni sürüm" diye bir şey yok; digest kontrolünün işi.
    for (const tag of ["latest", "stable", "main", "edge", ""]) {
      assert.equal(parseTag(tag), null, `${tag} reddedilmeliydi`);
    }
  });
});

describe("compareVersions", () => {
  it("eksik parçayı 0 sayar — 1.2 ile 1.2.0 aynı", () => {
    assert.equal(compareVersions(ayr("1.2"), ayr("1.2.0")), 0);
  });

  it("sayısal karşılaştırır, metin değil", () => {
    // Metin sıralamasında "10" < "9" olurdu.
    assert.ok(compareVersions(ayr("1.10.0"), ayr("1.9.0")) > 0);
  });

  it("CalVer'i doğru sıralar", () => {
    assert.ok(compareVersions(ayr("2024.12.5"), ayr("2024.2.1")) > 0);
    assert.ok(compareVersions(ayr("2025.1.1"), ayr("2024.12.9")) > 0);
  });

  it("SÜRÜM kendi ÖN SÜRÜMÜNDEN büyüktür", () => {
    // Yalnızca sayılara bakan bir karşılaştırma bunu eşit sayar ve rc1
    // kullanan biri 1.5.0'ın çıktığını hiç öğrenemez.
    assert.ok(compareVersions(ayr("1.5.0"), ayr("1.5.0-rc1")) > 0);
  });

  it("ön sürümleri kendi aralarında sıralar", () => {
    assert.ok(compareVersions(ayr("1.5.0-rc2"), ayr("1.5.0-rc1")) > 0);
    assert.ok(compareVersions(ayr("1.5.0-rc1"), ayr("1.5.0-beta1")) > 0);
    assert.ok(compareVersions(ayr("1.5.0-beta1"), ayr("1.5.0-alpha1")) > 0);
  });

  it("sayısız ön sürüm, sayılıdan küçüktür — rc < rc1", () => {
    assert.ok(compareVersions(ayr("1.5.0-rc1"), ayr("1.5.0-rc")) > 0);
  });
});

describe("bumpOf", () => {
  it("yama, minör ve majörü ayırır", () => {
    assert.equal(bumpOf(ayr("1.4.2"), ayr("1.4.3")), "yama");
    assert.equal(bumpOf(ayr("1.4.2"), ayr("1.5.0")), "minor");
    assert.equal(bumpOf(ayr("1.4.2"), ayr("2.0.0")), "major");
  });

  it("eski ya da eşit sürüme null döner", () => {
    assert.equal(bumpOf(ayr("1.4.2"), ayr("1.4.1")), null);
    assert.equal(bumpOf(ayr("1.4.2"), ayr("1.4.2")), null);
  });
});

describe("suggestUpgrade", () => {
  const ETIKETLER = ["1.4.1", "1.4.2", "1.4.5", "1.5.0", "2.0.0", "latest", "1.5.0-rc1"];

  it("sınırlar içindeki EN YÜKSEK sürümü önerir", () => {
    // 1.4.3 varken 1.4.5 dururken ilkini önermek iki kez güncellemeye zorlardı.
    const sonuc = suggestUpgrade("1.4.2", ETIKETLER, { ...AYARLAR, maxBump: "yama" });
    assert.equal(sonuc?.tag, "1.4.5");
    assert.equal(sonuc?.bump, "yama");
  });

  it("azami sıçrama minör iken majörü ÖNERMEZ", () => {
    const sonuc = suggestUpgrade("1.4.2", ETIKETLER, { ...AYARLAR, maxBump: "minor" });
    assert.equal(sonuc?.tag, "1.5.0");
  });

  it("azami sıçrama majör iken en yükseği önerir", () => {
    assert.equal(suggestUpgrade("1.4.2", ETIKETLER, AYARLAR)?.tag, "2.0.0");
  });

  it("ön sürüm kapalıyken -rc ÖNERMEZ", () => {
    const sonuc = suggestUpgrade("1.4.2", ["1.5.0-rc1"], AYARLAR);
    assert.equal(sonuc, null);
  });

  it("ön sürüm açıkken -rc önerir", () => {
    const sonuc = suggestUpgrade("1.4.2", ["1.5.0-rc1"], {
      ...AYARLAR,
      includePrerelease: true,
    });
    assert.equal(sonuc?.tag, "1.5.0-rc1");
  });

  it("ÇALIŞAN etiket ön sürümse ön sürümler kendiliğinden değerlendirilir", () => {
    // rc1 kullanan birine rc2'yi göstermemek anlamsız.
    const sonuc = suggestUpgrade("1.5.0-rc1", ["1.5.0-rc2"], AYARLAR);
    assert.equal(sonuc?.tag, "1.5.0-rc2");
  });

  it("LEZZET SÜZGECİ açıkken yalnızca aynı lezzeti önerir", () => {
    const sonuc = suggestUpgrade("1.2-alpine", ["1.5", "1.3-alpine", "1.4-slim"], {
      ...AYARLAR,
      matchFlavor: true,
    });
    assert.equal(sonuc?.tag, "1.3-alpine");
  });

  it("lezzet süzgeci KAPALIYKEN lezzet değişebilir", () => {
    const sonuc = suggestUpgrade("1.2-alpine", ["1.5"], AYARLAR);
    assert.equal(sonuc?.tag, "1.5");
  });

  it("ayrıştırılamayan etiketleri sessizce ATLAR", () => {
    // Kayıt defteri listelerinde bol miktarda "latest", "sha-abc123" var.
    const sonuc = suggestUpgrade("1.4.2", ["latest", "sha-abc123", "main", "1.4.3"], AYARLAR);
    assert.equal(sonuc?.tag, "1.4.3");
  });

  it("ön sürüm kullanana SÜRÜMÜN KENDİSİNİ önerir", () => {
    const sonuc = suggestUpgrade("1.5.0-rc1", ["1.5.0"], AYARLAR);
    assert.equal(sonuc?.tag, "1.5.0");
  });

  it("çalışan etiket sürüm DEĞİLSE öneri üretmez", () => {
    assert.equal(suggestUpgrade("latest", ["1.0.0"], AYARLAR), null);
  });

  it("daha yeni sürüm yoksa null döner", () => {
    assert.equal(suggestUpgrade("2.0.0", ETIKETLER, AYARLAR), null);
  });

  it("boş etiket listesinde PATLAMAZ", () => {
    assert.equal(suggestUpgrade("1.0.0", [], AYARLAR), null);
  });
});
