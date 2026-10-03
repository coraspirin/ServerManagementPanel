import "server-only";

/**
 * Dil ayarını OKUYAN taraf.
 *
 * `runtime.ts`ten ayrı duruyor çünkü burası `server-only` ve `@/` kullanıyor:
 * ikisi de `node --test` altında çözülemez. Kütüphane kodu runtime'ı, sunucu
 * bileşenleri burayı içe aktarır.
 */

import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";
import { getString } from "@/lib/settings";
import { isLocale } from "@/locales";
import { LOCALE_COOKIE, SOURCE_LOCALE, type Dictionary, type Locale } from "./locales.ts";
import { getDictionary, setLocaleResolver, translator } from "./runtime.ts";
import type { TFunction } from "./translate.ts";

/**
 * Panelin genel dili (Ayarlar → Genel → Dil).
 *
 * Try/catch bilerek: bu işlev migration'lar koşmadan önce de (açılışın ilk
 * anları) çağrılabiliyor ve o sırada `settings` tablosu henüz yok. Kayıtlı dil
 * dosyası silinmişse de kaynak dile düşülüyor — dilsiz kalmaktansa Türkçe.
 */
export function defaultLocale(): Locale {
  try {
    const value = getString("general.language");
    return isLocale(value) ? value : SOURCE_LOCALE;
  } catch {
    return SOURCE_LOCALE;
  }
}

/**
 * Bu isteğin kişisel dil çerezi; istek dışında (arka plan işi, bildirim,
 * açılış) ya da çerez yoksa null.
 *
 * ⚠️ Next'in İÇ API'si: `cookies()` Next 16'da yalnızca async, oysa dil her
 *    yerden — kütüphane kodu, `serverT`, senkron bileşenler — senkron
 *    soruluyor. Çerez bu yüzden Next'in istek deposundan senkron okunuyor.
 *    Next bu yapıyı değiştirirse try/catch genel dile düşürür: kişisel tercih
 *    çalışmaz ama hiçbir şey kırılmaz. Next yükseltmesinde dil seçiciyle sınanmalı.
 */
export function personalLocale(): Locale | null {
  try {
    const store = workUnitAsyncStorage.getStore();
    if (store?.type !== "request") return null;
    const value = store.cookies.get(LOCALE_COOKIE)?.value;
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Etkin arayüz dili: kişisel tercih, yoksa genel dil.
 *
 * Arka plan işleri ve bildirimler istek dışında çalıştığı için her zaman
 * genel dili kullanıyor — bilerek: bir Telegram mesajının dili, o an paneli
 * açık tutan birinin tarayıcısına göre değişmemeli.
 */
export function getLocale(): Locale {
  return personalLocale() ?? defaultLocale();
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
