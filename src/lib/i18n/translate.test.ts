/**
 * Çeviri çekirdeğinin sözleşme testleri.
 *
 * En kritik iddia EKSİK ANAHTAR SESSİZCE BOŞ DÖNMEZ: boş dize, eksik çeviriyi
 * "bu alan zaten boştu" gibi gösterir ve gözden kaçardı.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createT, translateLoose } from "./translate.ts";
import { tr } from "./dict/tr/index.ts";
import { en } from "./dict/en/index.ts";

describe("createT", () => {
  it("noktalı anahtarı sözlükte bulur", () => {
    assert.equal(createT(tr, "tr")("common.actions.save"), "Kaydet");
    assert.equal(createT(en, "en")("common.actions.save"), "Save");
  });

  it("yer tutucuyu doldurur", () => {
    assert.equal(
      translateLoose({ hi: "Merhaba {name}" }, "tr", "hi", { name: "Mücahid" }),
      "Merhaba Mücahid",
    );
  });

  it("karşılığı olmayan yer tutucuyu olduğu gibi bırakır", () => {
    assert.equal(translateLoose({ hi: "Merhaba {name}" }, "tr", "hi"), "Merhaba {name}");
  });

  it("bulunamayan anahtarın kendisini döndürür", () => {
    assert.equal(createT(tr, "tr")("common.actions.save" + ".yok" as never), "common.actions.save.yok");
    assert.equal(translateLoose(tr, "tr", "hic.olmayan.yol"), "hic.olmayan.yol");
  });

  it("İngilizcede çoğul biçimi seçer", () => {
    const t = createT(en, "en");
    assert.equal(t("common.duration.day", { count: 1 }), "1 day");
    assert.equal(t("common.duration.day", { count: 3 }), "3 days");
  });

  it("Türkçede çoğul eki yok — iki biçim de aynı", () => {
    const t = createT(tr, "tr");
    assert.equal(t("common.duration.day", { count: 1 }), "1 gün");
    assert.equal(t("common.duration.day", { count: 3 }), "3 gün");
  });
});
