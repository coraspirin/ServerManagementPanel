import "server-only";

/**
 * Dil ayarını OKUYAN taraf.
 *
 * `runtime.ts`ten ayrı duruyor çünkü burası `server-only` ve `@/` kullanıyor:
 * ikisi de `node --test` altında çözülemez. Kütüphane kodu runtime'ı, sunucu
 * bileşenleri burayı içe aktarır.
 */

import { getString } from "@/lib/settings";
import { isLocale } from "@/locales";
import { SOURCE_LOCALE, type Dictionary, type Locale } from "./locales.ts";
import { getDictionary, setLocaleResolver, translator } from "./runtime.ts";
import type { TFunction } from "./translate.ts";

/**
 * Seçili arayüz dili.
 *
 * Try/catch bilerek: bu işlev migration'lar koşmadan önce de (açılışın ilk
 * anları) çağrılabiliyor ve o sırada `settings` tablosu henüz yok. Kayıtlı dil
 * dosyası silinmişse de kaynak dile düşülüyor — dilsiz kalmaktansa Türkçe.
 */
export function getLocale(): Locale {
  try {
    const value = getString("general.language");
    return isLocale(value) ? value : SOURCE_LOCALE;
  } catch {
    return SOURCE_LOCALE;
  }
}

/** Sunucu bileşenleri için çeviri işlevi. */
export function getT(): TFunction {
  return translator(getLocale());
}

/** İstemciye prop olarak geçilecek sözlük — yalnızca SEÇİLİ dil, eksikleri dolu. */
export function getActiveDictionary(): Dictionary {
  return getDictionary(getLocale());
}

/** Açılışta bir kez: kütüphane kodunun dili görebilmesi için (bkz. runtime.ts). */
export function registerLocaleResolver(): void {
  setLocaleResolver(getLocale);
}
