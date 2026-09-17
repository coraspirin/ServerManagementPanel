/**
 * Kodda sabit yazılmış Türkçe metni arar.
 *
 * Kullanıcıya görünen her metin src/locales/*.json'dan gelmeli; bu betik
 * dil dosyasına taşınmamış metni yakalar. İki işaret:
 *   - Türkçeye özgü harf (ç ğ ı ö ş ü …) içeren bir metin,
 *   - Türkçe harf içermese de Türkçeye özgü bir kelime ("kartta widget yok").
 *
 * Bilerek atlananlar: yorumlar, console.* satırları, testler, dil dosyaları ve
 * i18n katmanı, migration'lar, sahte sağlayıcılar, text.ts'teki harf katlama
 * tablosu. Protokol gereği Türkçe kalması gereken bir satır (ör. host-helper
 * çıktısıyla eşleşme) satır sonuna `// i18n-ignore` yazılarak işaretlenir.
 * Satır çok satırlı bir şablon metninin (`...`) içindeyse yorum metnin parçası
 * olur — o durumda bir önceki satıra `// i18n-ignore-next-line` yazılır.
 *
 * Kullanım: npm run i18n:scan  — bulgu varsa çıkış kodu 1.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = "src";

const SKIP = [
  /\.test\.tsx?$/,
  /^src\/locales\//,
  /^src\/lib\/i18n\//,
  /^src\/lib\/db\/migrations\//,
  /\.mock\.ts$/,
  /^src\/lib\/text\.ts$/,
];

const DIACRITIC = /[çğıöşüÇĞİÖŞÜ]/;

// Yalnızca Türkçede geçen, harfsiz yazılışı olan kelimeler. İngilizceyle
// çakışanlar ("not", "ad", "mod", "var", "ara") bilerek yok.
const WORDS = new RegExp(
  "\\b(" +
    [
      "yok", "gerekli", "bilinmeyen", "olabilir", "destekler", "verin", "bir", "ve", "ile",
      "icin", "degil", "kayit", "bulunamadi", "hata", "basarili", "tamam", "ayakta", "yeni",
      "eski", "ekle", "kaydet", "iptal", "kapat", "ayarlar", "sunucu", "parola", "anahtar",
      "kanal", "dakika", "saniye", "saat", "hafta", "adet", "kez", "kere", "kullanici",
      "dosya", "klasor", "yol", "adres", "cihaz", "durum", "durdur", "baslat", "yeniden",
      "bekleniyor", "hazir", "secin", "gonder", "tum", "hepsi", "ekran", "pencere", "bakim",
      "uyari", "bilgi", "onay", "onayla", "vazgec", "geri", "filtre", "gizle", "goster",
      "acik", "kapali", "pasif", "zaman", "tarih", "mesaj", "kural", "eylem", "listesi",
      "henuz", "daha", "sonra", "once", "lutfen", "olarak", "kadar", "veya", "ya da",
    ].join("|") +
    ")\\b",
  "i",
);

const LITERAL = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|>[^<>{}\n]*[A-Za-zçğıöşüÇĞİÖŞÜ][^<>{}\n]*</g;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full.split(path.sep).join("/"));
  }
  return out;
}

/** Blok yorumları satır sayısını koruyarak boşaltır. */
function stripBlockComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

/** Tırnak dışında kalan `//` yorumunu keser. */
function stripLineComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "/" && line[i + 1] === "/") return line.slice(0, i);
  }
  return line;
}

function isTurkish(text) {
  // Import yolu, CSS sınıfı ya da tek kelimelik kimlik değil — insan metni.
  const inner = text.slice(1, -1);
  if (DIACRITIC.test(inner)) return true;
  // Kelime işareti yalnızca boşluk içeren (cümle kurabilecek) metinlerde.
  return /\s/.test(inner.trim()) && WORDS.test(inner.replace(/\$\{[^}]*\}/g, " "));
}

const findings = [];
for (const file of walk(ROOT)) {
  if (SKIP.some((re) => re.test(file))) continue;
  const lines = stripBlockComments(fs.readFileSync(file, "utf8")).split("\n");
  lines.forEach((raw, index) => {
    if (index > 0 && lines[index - 1].includes("i18n-ignore-next-line")) return;
    if (/i18n-ignore|console\.(log|warn|error|info|debug)/.test(raw)) return;
    if (/^\s*(import|export .* from)\b/.test(raw)) return;
    const line = stripLineComment(raw);
    // Birden çok satıra yayılan JSX metni: kod karakteri içermeyen düz satır.
    const bare = line.trim();
    if (file.endsWith(".tsx") && bare && !/[=;(){}"'`<>]/.test(bare) && isTurkish(` ${bare} `)) {
      findings.push(`${file}:${index + 1}  ${bare.slice(0, 100)}`);
      return;
    }
    for (const match of line.matchAll(LITERAL)) {
      if (isTurkish(match[0])) {
        findings.push(`${file}:${index + 1}  ${match[0].slice(0, 100)}`);
        break;
      }
    }
  });
}

if (findings.length === 0) {
  console.log("✔ Kodda sabit Türkçe metin yok.");
} else {
  console.log(findings.join("\n"));
  console.log(`\n✖ ${findings.length} satırda dil dosyasına taşınmamış metin var.`);
  console.log("  Metni src/locales/*.json'a taşıyın; protokol gereği kalması gerekiyorsa satıra // i18n-ignore ekleyin.");
  process.exitCode = 1;
}
