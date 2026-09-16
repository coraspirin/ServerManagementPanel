/**
 * Dil kodu ve sözlük tipi — BAĞIMLILIKSIZ.
 *
 * İstemci bileşenleri, sunucu kodu ve `node --test` altında koşan testler aynı
 * dosyayı içe aktarıyor. Burada JSON YOK: dillerin kendisi `src/locales/`
 * kaydında. Buraya bir dil dosyası içe aktarmak onu tarayıcı paketine taşır.
 */

/** "tr", "en", "fr"… — kayıtlı dil dosyasının adı. */
export type Locale = string;

/** Düz sözlük: `"nav.items.host": "Sunucu"`. */
export type Dictionary = Readonly<Record<string, string>>;

/** Kaynak dil: anahtarların listesi ondan çıkıyor, eksik metin ona düşüyor. */
export const SOURCE_LOCALE: Locale = "tr";

/**
 * Intl API'lerinin beklediği BCP-47 etiketi — dil dosyasının `_meta.intl` alanı.
 *
 * Bölge kodu BİLEREK dosyada ("tr-TR", "en-US"): yalnızca "tr" verildiğinde
 * tarih/saat biçimini çalışma ortamı belirler, sunucu ile tarayıcı farklı
 * ortamlar olduğu için bu sessiz bir hydration uyuşmazlığı demek.
 */
export function intlOf(dict: Dictionary): string {
  return dict["_meta.intl"] || "tr-TR";
}
