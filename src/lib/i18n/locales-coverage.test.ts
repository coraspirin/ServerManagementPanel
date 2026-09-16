/**
 * Dil dosyaları arasında tutarlılık — `npm run i18n:check` ile aynı kurallar.
 *
 * Tamamlanmış bir dilde eksik, fazla ya da yer tutucusu bozuk metin testi
 * kırar. Taslak (`_meta.status: "draft"`) diller yalnızca meta alanları
 * açısından denetlenir: çevirisi sürerken eksik metin Türkçeye düşüyor.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkLocale, hasBlockingProblems } from "./check.ts";
import { rawLocale, registeredLocales } from "../../locales/index.ts";

const source = rawLocale("tr") ?? {};

describe("kayıtlı diller", () => {
  for (const code of registeredLocales()) {
    it(`${code}: kaynakla tutarlı`, () => {
      const report = checkLocale(code, source, rawLocale(code) ?? {});
      assert.equal(
        hasBlockingProblems(report),
        false,
        JSON.stringify(
          {
            meta: report.meta,
            missing: report.missing.slice(0, 10),
            extra: report.extra.slice(0, 10),
            placeholders: report.placeholders.slice(0, 5),
          },
          null,
          2,
        ),
      );
    });
  }

  it("klasördeki her JSON kayıtlı, kayıttaki her dilin dosyası var", () => {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../locales");
    const dosyalar = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
    assert.deepEqual(dosyalar, [...registeredLocales()].sort());
  });
});

describe("denetleyici", () => {
  const kaynak = {
    "_meta.name": "Türkçe",
    "_meta.intl": "tr-TR",
    "a.selam": "Merhaba {name}",
    "a.gun.one": "{count} gün",
    "a.gun.other": "{count} gün",
  };

  it("eksik ve fazla anahtarı bulur", () => {
    const r = checkLocale("xx", kaynak, {
      "_meta.name": "X",
      "_meta.intl": "xx-XX",
      "a.selam": "Hi {name}",
      "a.gun.other": "{count} days",
      "a.yok": "fazla",
    });
    assert.deepEqual(r.missing, ["a.gun.one"]);
    assert.deepEqual(r.extra, ["a.yok"]);
  });

  it("yer tutucusu kaybolan metni bulur", () => {
    const r = checkLocale("xx", kaynak, {
      "_meta.name": "X",
      "_meta.intl": "xx-XX",
      "a.selam": "Hi there",
      "a.gun.one": "{count} day",
      "a.gun.other": "{count} days",
    });
    assert.equal(r.placeholders.length, 1);
    assert.equal(r.placeholders[0].key, "a.selam");
  });

  it("tekil biçimde {count} olmaması ve ek çoğul kategori sorun değil", () => {
    const r = checkLocale("pl", kaynak, {
      "_meta.name": "Polski",
      "_meta.intl": "pl-PL",
      "a.selam": "Cześć {name}",
      "a.gun.one": "dzień",
      "a.gun.few": "{count} dni",
      "a.gun.other": "{count} dni",
    });
    assert.deepEqual(r.placeholders, []);
    assert.deepEqual(r.extra, []);
  });

  it("taslak dilde eksik metin engel değil, meta eksiği engel", () => {
    const taslak = checkLocale("fr", kaynak, {
      "_meta.name": "Français",
      "_meta.intl": "fr-FR",
      "_meta.status": "draft",
    });
    assert.equal(hasBlockingProblems(taslak), false);

    const metasiz = checkLocale("fr", kaynak, { "_meta.status": "draft" });
    assert.equal(hasBlockingProblems(metasiz), true);
  });
});
