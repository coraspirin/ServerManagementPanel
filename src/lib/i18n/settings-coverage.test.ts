/**
 * Şema ile KAYNAK dil dosyasının örtüşmesi.
 *
 * Şemaya yeni bir ayar eklendiğinde Türkçe dosyada karşılığı yoksa ayar
 * ekranda anahtarıyla ("docker.stats_interval") görünür — bu test onu yakalar.
 * Diğer dillerin Türkçeyle aynı anahtarlara sahip olması ayrı denetim:
 * `locales-coverage.test.ts`.
 *
 * Şema yalnızca tip içe aktarıyor, bu yüzden test koşucusu altında da
 * yüklenebiliyor.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { settingDefs, settingGroups } from "../../settings.schema.ts";
import { rawLocale } from "../../locales/index.ts";

const tr = rawLocale("tr") ?? {};

describe("ayar metinleri (kaynak dil)", () => {
  it("her ayarın adı var", () => {
    const eksik = settingDefs
      .filter((def) => !tr[`settings.items.${def.key}.label`])
      .map((def) => def.key);
    assert.deepEqual(eksik, [], `dil dosyasında karşılığı olmayan ayar: ${eksik.join(", ")}`);
  });

  it("her kategorinin adı var", () => {
    const eksik = settingGroups
      .filter((g) => !tr[`settings.groups.${g.key}.label`])
      .map((g) => g.key);
    assert.deepEqual(eksik, []);
  });

  it("her bölüm başlığının karşılığı var", () => {
    const eksik = [...new Set(settingDefs.map((d) => d.section).filter(Boolean))].filter(
      (section) => !tr[`settings.sections.${section}`],
    );
    assert.deepEqual(eksik, []);
  });

  it("her enum seçeneğinin adı var", () => {
    const eksik: string[] = [];
    for (const def of settingDefs) {
      for (const value of def.options ?? []) {
        if (!tr[`settings.items.${def.key}.options.${value}`]) eksik.push(`${def.key}.${value}`);
      }
    }
    assert.deepEqual(eksik, []);
  });

  it("dil dosyasında şemada olmayan ayar yok", () => {
    const keys = new Set(settingDefs.map((d) => d.key));
    const fazla = Object.keys(tr)
      .map((k) => /^settings\.items\.(.+)\.label$/.exec(k)?.[1])
      .filter((k): k is string => k !== undefined && !keys.has(k));
    assert.deepEqual(fazla, [], `şemadan silinmiş ama dosyada duran: ${fazla.join(", ")}`);
  });
});
