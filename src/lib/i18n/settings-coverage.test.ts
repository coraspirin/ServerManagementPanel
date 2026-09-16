/**
 * Şema ile sözlüğün ÖRTÜŞMESİ.
 *
 * Tip denetimi İngilizcenin Türkçeyle aynı anahtarlara sahip olmasını garanti
 * ediyor ama şemaya yeni bir ayar eklendiğinde ikisinde de o anahtarın
 * OLMADIĞINI göremez: sözlük şemadan türemiyor, yan yana duruyor. Karşılığı
 * olmayan ayar ekranda anahtarının kendisiyle ("docker.stats_interval")
 * görünür — bu test onu derlemede değil, testte yakalar.
 *
 * Şema yalnızca tip içe aktarıyor, bu yüzden test koşucusu altında da
 * yüklenebiliyor.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { settingDefs, settingGroups } from "../../settings.schema.ts";
import { tr } from "./dict/tr/index.ts";
import { en } from "./dict/en/index.ts";

const DILLER = [
  ["tr", tr],
  ["en", en],
] as const;

describe("ayar sözlüğü", () => {
  for (const [ad, dict] of DILLER) {
    it(`${ad}: her ayarın adı var`, () => {
      const eksik = settingDefs
        .filter((def) => !(def.key in dict.settings.items))
        .map((def) => def.key);
      assert.deepEqual(eksik, [], `sözlükte karşılığı olmayan ayar: ${eksik.join(", ")}`);
    });

    it(`${ad}: her kategorinin adı var`, () => {
      const groups = dict.settings.groups as Record<string, unknown>;
      const eksik = settingGroups.filter((g) => !(g.key in groups)).map((g) => g.key);
      assert.deepEqual(eksik, []);
    });

    it(`${ad}: her bölüm başlığının karşılığı var`, () => {
      const sections = dict.settings.sections as Record<string, unknown>;
      const eksik = [...new Set(settingDefs.map((d) => d.section).filter(Boolean))].filter(
        (s) => !(String(s) in sections),
      );
      assert.deepEqual(eksik, []);
    });

    it(`${ad}: her enum seçeneğinin adı var`, () => {
      const items = dict.settings.items as Record<string, { options?: Record<string, string> }>;
      const eksik: string[] = [];
      for (const def of settingDefs) {
        if (!def.options) continue;
        for (const value of def.options) {
          if (!items[def.key]?.options?.[value]) eksik.push(`${def.key}.${value}`);
        }
      }
      assert.deepEqual(eksik, []);
    });

    it(`${ad}: sözlükte şemada olmayan ayar yok`, () => {
      const keys = new Set(settingDefs.map((d) => d.key));
      const fazla = Object.keys(dict.settings.items).filter((k) => !keys.has(k));
      assert.deepEqual(fazla, [], `şemadan silinmiş ama sözlükte duran: ${fazla.join(", ")}`);
    });
  }
});
