/**
 * Yeni bir dil için taslak dosya üretir ve kaydeder.
 *
 *   npm run i18n:new -- fr "Français" fr-FR
 *
 * `src/locales/<kod>.json` dosyasını Türkçe dosyadan TÜRETİR: bütün anahtarlar
 * aynı sırayla, değerleri Türkçe metin — çevirmen ya da bir çeviri aracı
 * değerlerin üzerine yazar. Dosya `"_meta.status": "draft"` ile başlar; dil
 * Ayarlar'da "(taslak)" diye görünür ve çevrilmemiş metinler Türkçe kalır.
 *
 * Çeviri bitince `_meta.status` satırı silinir ve `npm run i18n:check`
 * çalıştırılır: tamamlanmış dilde eksik metin artık hata sayılır.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "src/locales");
const INDEX = path.join(DIR, "index.ts");

function fail(message) {
  console.error(`✖ ${message}`);
  console.error('Kullanım: npm run i18n:new -- <kod> "<Görünen ad>" <intl etiketi>');
  console.error('Örnek:    npm run i18n:new -- fr "Français" fr-FR');
  process.exit(1);
}

const [code, name, intl] = process.argv.slice(2);

if (!code || !name || !intl) fail("üç değer gerekli.");
if (!/^[a-z]{2,3}(-[A-Z]{2})?$/.test(code)) fail(`geçersiz dil kodu: "${code}" (ör. fr, de, pt-BR)`);

try {
  Intl.getCanonicalLocales(intl);
  new Intl.PluralRules(intl);
} catch {
  fail(`geçersiz Intl etiketi: "${intl}" (ör. fr-FR, de-DE)`);
}

const target = path.join(DIR, `${code}.json`);
if (fs.existsSync(target)) fail(`${code}.json zaten var — üzerine yazılmaz.`);

// --- 1. Taslak dosya: Türkçe dosyadan türetiliyor, sıra korunuyor ---
const source = JSON.parse(fs.readFileSync(path.join(DIR, "tr.json"), "utf8"));
const draft = { "_meta.name": name, "_meta.intl": intl, "_meta.status": "draft" };
for (const [key, value] of Object.entries(source)) {
  if (!key.startsWith("_meta.")) draft[key] = value;
}
fs.writeFileSync(target, JSON.stringify(draft, null, 2) + "\n");

// --- 2. Kayıt: iki işaretli bloğa ekle, sıralı tut ---
const identifier = code.replace("-", "_");
const importLine = `import ${identifier} from "./${code}.json" with { type: "json" };`;
const entryLine = identifier === code ? `  ${code},` : `  "${code}": ${identifier},`;

function addToBlock(text, startMarker, endMarker, line) {
  const pattern = new RegExp(`(${startMarker}\\n)([\\s\\S]*?)(\\s*${endMarker})`);
  const match = pattern.exec(text);
  if (!match) fail(`kayıtta "${startMarker}" bloğu bulunamadı: ${INDEX}`);
  const lines = match[2].split("\n").filter((l) => l.trim());
  lines.push(line);
  lines.sort((a, b) => a.trim().localeCompare(b.trim()));
  return text.replace(pattern, `$1${lines.join("\n")}$3`);
}

let index = fs.readFileSync(INDEX, "utf8");
index = addToBlock(index, "// i18n:imports", "// i18n:imports-end", importLine);
index = addToBlock(index, "  // i18n:files", "// i18n:files-end", entryLine);
fs.writeFileSync(INDEX, index);

console.log(`✔ src/locales/${code}.json oluşturuldu (${Object.keys(draft).length - 3} metin, taslak)`);
console.log(`✔ src/locales/index.ts kaydına eklendi`);
console.log("");
console.log("Sıradaki adımlar:");
console.log(`  1. src/locales/${code}.json içindeki değerleri çevir (anahtarlara ve {yer tutuculara} dokunma).`);
console.log(`  2. npm run i18n:check — ilerlemeyi ve bozuk yer tutucuları gösterir.`);
console.log(`  3. Çeviri bitince "_meta.status" satırını sil; dil tamamlanmış sayılır.`);
