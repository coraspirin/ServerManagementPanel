/**
 * Biçimlendirilmiş metin alanlarının temizlenmesi (M3.45).
 *
 * Karşılama duyurusu artık zengin metin kutusuyla yazılıyor ve sonuç HTML
 * olarak saklanıyor. O HTML, oturum AÇMAMIŞ herkesin gördüğü sayfada
 * çiziliyor — yani `dangerouslySetInnerHTML` kullanılan tek yer burası ve
 * güvenliği tek bir yerde, bu modülde toplanıyor.
 *
 * ## Neden beyaz liste, kara liste değil
 *
 * "`<script>` sil" biçiminde bir kara liste her zaman eksik kalır:
 * `onerror`, `javascript:` şeması, `<iframe>`, `<object>`, `<svg>` içindeki
 * olay öznitelikleri. Beyaz listede ise BİLİNMEYEN her şey düşüyor ve yeni
 * bir saldırı biçimi listeyi geçersiz kılmıyor.
 *
 * ## Neden alan zaten yetkiliye açıkken temizleniyor
 *
 * Bu alanı yalnızca `settings.edit` izni olan biri yazabiliyor ve o kişi
 * panelin tamamına zaten hâkim. Ama duyuru ANONİM sayfada görünüyor: temizlik
 * olmadan, paneli yöneten kişinin hesabı ele geçirilirse saldırgan panele
 * hiç girmemiş ziyaretçilerin tarayıcısında kod çalıştırabilirdi. Ayrıca
 * yapılandırma dışa/içe aktarımı (ConfigTransfer) bu değeri taşıyor.
 *
 * I/O yok, DOM yok: hem sunucuda hem tarayıcıda aynı sonucu vermeli.
 */

/** İzin verilen etiketler. Öznitelik yalnızca `<a href>` üzerinde kalır. */
const ALLOWED = new Set([
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "ul",
  "ol",
  "li",
  "a",
  "code",
  "blockquote",
]);

/** İçeriğiyle birlikte tamamen atılan etiketler. */
const DROP_WITH_CONTENT = ["script", "style", "iframe", "object", "embed", "template"];

function safeHref(raw: string): string | null {
  const value = raw.trim().replace(/\s+/g, "");
  // `javascript:`, `data:` ve şemasız `//evil` dışarıda; göreli yollar serbest.
  if (/^(https?:|mailto:)/i.test(value)) return value;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  return null;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export function sanitizeRichText(input: string): string {
  if (!input) return "";

  let html = input;

  // Yorumlar ve içeriğiyle birlikte atılanlar önce: bunların İÇİ de gitmeli,
  // yoksa `<script>alert(1)</script>` etiketleri düşse bile gövde metin
  // olarak sayfada kalırdı.
  html = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of DROP_WITH_CONTENT) {
    html = html.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}\\s*>`, "gi"), "");
    html = html.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi"), "");
  }

  html = html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (match, rawName, rawAttrs) => {
    const name = String(rawName).toLowerCase();
    if (!ALLOWED.has(name)) return "";

    // Kapanış etiketinde öznitelik olmaz.
    if (match.startsWith("</")) return `</${name}>`;
    if (name === "br") return "<br>";

    if (name === "a") {
      const href = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(String(rawAttrs));
      const value = href ? (href[2] ?? href[3] ?? href[4] ?? "") : "";
      const safe = safeHref(value);
      // Bağlantı hedefi güvenli değilse ETİKET kalıyor ama href düşüyor:
      // metni silmek, kullanıcının yazdığı cümleden bir parçayı yok etmek olurdu.
      return safe
        ? `<a href="${escapeAttr(safe)}" target="_blank" rel="noopener noreferrer nofollow">`
        : "<a>";
    }

    return `<${name}>`;
  });

  // `<` ile başlayıp etiket olmayan kalıntılar (ör. "3 < 5") metne dönmeli.
  html = html.replace(/<(?![a-zA-Z/])/g, "&lt;");

  return html.trim();
}

/** Etiketleri atıp düz metne indirger — "boş mu" kontrolü ve önizleme için. */
export function richTextToPlain(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|li|ul|ol|blockquote)>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Görünür bir içerik var mı — `<p><br></p>` gibi boş kabuklar sayılmaz. */
export function isRichTextEmpty(input: string): boolean {
  return richTextToPlain(input).length === 0;
}
