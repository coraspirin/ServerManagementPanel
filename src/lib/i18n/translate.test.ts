/**
 * Çeviri çekirdeğinin sözleşme testleri.
 *
 * En kritik iki iddia:
 *   - EKSİK ANAHTAR SESSİZCE BOŞ DÖNMEZ: boş dize, eksik çeviriyi "bu alan
 *     zaten boştu" gibi gösterir ve gözden kaçardı.
 *   - EKSİK ÇEVİRİ KAYNAK DİLE DÜŞER: taslak bir dilde çevrilmemiş metin ham
 *     anahtar olarak değil Türkçe görünür.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createT, translateLoose } from "./translate.ts";
import { localeDictionary, rawLocale } from "../../locales/index.ts";

const tr = localeDictionary("tr");
const en = localeDictionary("en");

describe("createT", () => {
  it("düz anahtarı sözlükte bulur", () => {
    assert.equal(createT(tr)("common.actions.save"), "Kaydet");
    assert.equal(createT(en)("common.actions.save"), "Save");
  });

  it("yer tutucuyu doldurur", () => {
    assert.equal(
      translateLoose({ hi: "Merhaba {name}" }, "hi", { name: "Mücahid" }),
      "Merhaba Mücahid",
    );
  });

  it("karşılığı olmayan yer tutucuyu olduğu gibi bırakır", () => {
    assert.equal(translateLoose({ hi: "Merhaba {name}" }, "hi"), "Merhaba {name}");
  });

  it("${NAME} yer tutucu değil, metnin kendisidir", () => {
    assert.equal(
      translateLoose({ k: "tanımsız ${VAR} ve {name}" }, "k", { name: "x", VAR: "YANLIŞ" }),
      "tanımsız ${VAR} ve x",
    );
  });

  it("bulunamayan anahtarın kendisini döndürür", () => {
    assert.equal(translateLoose(tr, "hic.olmayan.yol"), "hic.olmayan.yol");
  });
});

describe("çoğul", () => {
  it("İngilizcede one/other ayrımını yapar", () => {
    const t = createT(en);
    assert.equal(t("common.duration.day", { count: 1 }), "1 day");
    assert.equal(t("common.duration.day", { count: 3 }), "3 days");
  });

  it("Türkçede iki biçim de aynı", () => {
    const t = createT(tr);
    assert.equal(t("common.duration.day", { count: 1 }), "1 gün");
    assert.equal(t("common.duration.day", { count: 3 }), "3 gün");
  });

  it("dilin kendi kategorisini kullanır (Lehçe 'few')", () => {
    const pl = {
      "_meta.intl": "pl-PL",
      "x.one": "{count} plik",
      "x.few": "{count} pliki",
      "x.other": "{count} plików",
    };
    assert.equal(translateLoose(pl, "x", { count: 1 }), "1 plik");
    assert.equal(translateLoose(pl, "x", { count: 3 }), "3 pliki");
    assert.equal(translateLoose(pl, "x", { count: 5 }), "5 plików");
  });

  it("dosyada o kategori yoksa 'other'a düşer", () => {
    const yalnizOther = { "_meta.intl": "pl-PL", "x.other": "{count} öğe" };
    assert.equal(translateLoose(yalnizOther, "x", { count: 3 }), "3 öğe");
  });
});

describe("kaynak dile düşme", () => {
  it("bilinmeyen dil kodu Türkçe sözlüğü verir", () => {
    assert.equal(localeDictionary("xx")["common.actions.save"], "Kaydet");
  });

  it("dolgulu sözlük kaynak dilin her anahtarını taşır", () => {
    const kaynak = rawLocale("tr") ?? {};
    const eksik = Object.keys(kaynak).filter((key) => !(key in en));
    assert.deepEqual(eksik, []);
  });
});
