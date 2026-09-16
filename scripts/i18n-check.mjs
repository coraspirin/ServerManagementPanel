/**
 * Dil dosyalarını kaynak dile (tr.json) göre denetler.
 *
 *   npm run i18n:check
 *
 * Her dil için eksik, fazla ve yer tutucusu bozuk metinleri listeler; ayrıca
 * klasördeki JSON'larla `src/locales/index.ts` kaydının örtüştüğüne bakar.
 *
 * Tamamlanmış bir dilde sorun varsa çıkış kodu 1 (CI bunu yakalar). Taslak
 * (`"_meta.status": "draft"`) dillerde yalnızca rapor verilir: çevirisi
 * sürerken eksik metin Türkçeye düşüyor.
 *
 * Kurallar `locales-coverage.test.ts` ile AYNI: ikisi de `check.ts`i
 * kullanıyor.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkLocale, hasBlockingProblems } from "../src/lib/i18n/check.ts";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "src/locales");
const SOURCE = "tr";

const readJson = (code) => JSON.parse(fs.readFileSync(path.join(DIR, `${code}.json`), "utf8"));

/** Kayıttaki diller: `// i18n:files` bloğundaki satırlardan. */
function registeredCodes() {
  const index = fs.readFileSync(path.join(DIR, "index.ts"), "utf8");
  const block = /\/\/ i18n:files\n([\s\S]*?)\/\/ i18n:files-end/.exec(index)?.[1] ?? "";
  return block
    .split("\n")
    .map((line) => line.trim().replace(/,$/, ""))
    .filter(Boolean)
    .map((entry) => (entry.includes(":") ? entry.split(":")[0].replace(/"/g, "").trim() : entry));
}

const files = fs
  .readdirSync(DIR)
  .filter((name) => name.endsWith(".json"))
  .map((name) => name.replace(/\.json$/, ""))
  .sort();

let failed = false;

const registered = registeredCodes().sort();
const unregistered = files.filter((code) => !registered.includes(code));
const orphaned = registered.filter((code) => !files.includes(code));
if (unregistered.length || orphaned.length) {
  failed = true;
  if (unregistered.length) {
    console.error(`✖ kayıtsız dil dosyası: ${unregistered.join(", ")} (src/locales/index.ts)`);
  }
  if (orphaned.length) console.error(`✖ kayıtlı ama dosyası yok: ${orphaned.join(", ")}`);
}

const source = readJson(SOURCE);
const total = Object.keys(source).filter((key) => !key.startsWith("_meta.")).length;
console.log(`Kaynak: ${SOURCE}.json — ${total} metin\n`);

for (const code of files) {
  if (code === SOURCE) continue;

  const report = checkLocale(code, source, readJson(code));
  const blocking = hasBlockingProblems(report);
  if (blocking) failed = true;

  const translated = total - report.missing.length;
  const status = report.draft ? "taslak" : "tamamlanmış";
  const mark = blocking ? "✖" : "✔";

  console.log(`${mark} ${code} (${status}) — ${translated}/${total} metin`);
  if (report.meta.length) console.log(`    meta: ${report.meta.join("; ")}`);
  if (report.missing.length) {
    console.log(`    eksik ${report.missing.length}: ${report.missing.slice(0, 8).join(", ")}${report.missing.length > 8 ? " …" : ""}`);
  }
  if (report.extra.length) {
    console.log(`    fazla ${report.extra.length}: ${report.extra.slice(0, 8).join(", ")}${report.extra.length > 8 ? " …" : ""}`);
  }
  for (const item of report.placeholders.slice(0, 8)) {
    console.log(
      `    yer tutucu: ${item.key} — beklenen {${item.expected.join("}, {")}}, bulunan {${item.actual.join("}, {")}}`,
    );
  }
  if (report.draft && report.sameAsSource > 0) {
    console.log(`    kaynakla aynı ${report.sameAsSource} metin (çevrilmemiş olabilir)`);
  }
}

process.exit(failed ? 1 : 0);
