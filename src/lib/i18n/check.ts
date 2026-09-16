/**
 * Dil dosyası denetimi — `npm run i18n:check` ve `locales-coverage.test.ts`
 * aynı kuralları buradan alıyor.
 *
 * Saf ve bağımlılıksız: dosya okumaz, iki sözlüğü karşılaştırır.
 */

import type { Dictionary } from "./locales.ts";
import { PLACEHOLDER } from "./translate.ts";

export type LocaleReport = {
  code: string;
  draft: boolean;
  /** Kaynakta olup bu dilde olmayan anahtarlar (eksik kalan Türkçeye düşer). */
  missing: string[];
  /** Kaynakta hiç olmayan anahtarlar — genelde yazım hatası ya da silinmiş metin. */
  extra: string[];
  /** Yer tutucusu kaynakla uyuşmayan metinler: `{count}` kaybolursa sayı görünmez. */
  placeholders: { key: string; expected: string[]; actual: string[] }[];
  /** `_meta.name` / `_meta.intl` eksik, `_meta.status` tanınmıyor. */
  meta: string[];
  /** Değeri kaynakla birebir aynı olan metin sayısı — çevrilmemiş olabilir. */
  sameAsSource: number;
};

/** Yeni bir dilin eklemeye hakkı olan çoğul kategorileri (CLDR). */
const PLURAL_CATEGORIES = ["zero", "one", "two", "few", "many", "other"];

/**
 * Tekil biçimler sayıyı göstermeyebilir: İngilizcede "{count} day" yerine
 * "a day" yazmak meşru. Bu kategorilerde eksik `{count}` sorun sayılmaz.
 */
const COUNT_OPTIONAL = new Set(["zero", "one", "two"]);

function placeholderSet(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]))].sort();
}

function isMeta(key: string): boolean {
  return key.startsWith("_meta.");
}

export function checkLocale(code: string, source: Dictionary, target: Dictionary): LocaleReport {
  const draft = target["_meta.status"] === "draft";
  const report: LocaleReport = {
    code,
    draft,
    missing: [],
    extra: [],
    placeholders: [],
    meta: [],
    sameAsSource: 0,
  };

  if (!target["_meta.name"]) report.meta.push("_meta.name yok");
  if (!target["_meta.intl"]) report.meta.push("_meta.intl yok");
  const status = target["_meta.status"];
  if (status !== undefined && status !== "draft") {
    report.meta.push(`_meta.status tanınmıyor: "${status}" (yalnızca "draft")`);
  }

  for (const [key, value] of Object.entries(source)) {
    if (isMeta(key)) continue;

    const own = target[key];
    if (own === undefined) {
      report.missing.push(key);
      continue;
    }
    if (own === value) report.sameAsSource++;

    const category = key.split(".").pop() ?? "";
    let expected = placeholderSet(value);
    const actual = placeholderSet(own);
    if (COUNT_OPTIONAL.has(category) && !actual.includes("count")) {
      expected = expected.filter((name) => name !== "count");
    }
    if (expected.join(",") !== actual.join(",")) {
      report.placeholders.push({ key, expected, actual });
    }
  }

  for (const key of Object.keys(target)) {
    if (isMeta(key) || Object.hasOwn(source, key)) continue;

    // Kaynakta olmayan bir çoğul kategorisi fazlalık değil: Lehçe "few"
    // ekleyebilir, yeter ki kaynakta o metnin çoğul biçimi (".other") olsun.
    const dot = key.lastIndexOf(".");
    const base = key.slice(0, dot);
    const category = key.slice(dot + 1);
    if (PLURAL_CATEGORIES.includes(category) && Object.hasOwn(source, `${base}.other`)) continue;

    report.extra.push(key);
  }

  return report;
}

/** Tamamlanmış bir dil için sorun var mı? Taslaklar yalnızca raporlanır. */
export function hasBlockingProblems(report: LocaleReport): boolean {
  if (report.meta.length > 0) return true;
  if (report.draft) return false;
  return report.missing.length > 0 || report.extra.length > 0 || report.placeholders.length > 0;
}
