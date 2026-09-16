/**
 * Desteklenen arayüz dilleri.
 *
 * Bu modül BİLEREK bağımlılıksız: hem sunucu kodu, hem istemci bileşenleri,
 * hem de `node --test` altında koşan saf testler aynı dosyayı içe aktarıyor.
 * Bu yüzden burada ne `server-only`, ne `@/` takma adı, ne de veritabanı var —
 * test koşucusu takma adları çözemiyor, `@/` yazmak testleri kırar.
 */

export type Locale = "tr" | "en";

export const LOCALES = ["tr", "en"] as const satisfies readonly Locale[];

/** Ayar okunamazsa ya da bozuksa düşülecek dil. Panelin ana dili Türkçe. */
export const DEFAULT_LOCALE: Locale = "tr";

export function isLocale(value: unknown): value is Locale {
  return value === "tr" || value === "en";
}

/**
 * Intl API'lerinin beklediği BCP-47 etiketi.
 *
 * Bölge kodu BİLEREK yazılıyor: yalnızca "tr" verildiğinde tarih/saat biçimini
 * çalışma ortamının varsayılanı belirler. Sunucu ile tarayıcı farklı ortamlar
 * olduğu için bu, sessiz bir hydration uyuşmazlığı demek.
 */
export function intlLocale(locale: Locale): string {
  return locale === "en" ? "en-US" : "tr-TR";
}
