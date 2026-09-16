/**
 * Sunucu tarafı çeviri girişi — veritabanına DOKUNMADAN.
 *
 * Kütüphane kodu (`src/lib/**`) ve API uçları kullanıcıya metin döndürürken
 * buradaki `serverT`yi çağırıyor. Ayarı okuyan asıl işlev `server.ts`te; o
 * dosya `server-only` ve `@/` içerdiği için `node --test` altında içe
 * aktarılamaz. Aradaki bağ bir kayıt işleviyle kuruluyor:
 *
 *   - Uygulama açılışında `instrumentation.ts` çözücüyü kaydeder.
 *   - Testlerde kimse kaydetmez; dil Türkçeye düşer ve Türkçe metin bekleyen
 *     mevcut testler aynen geçer.
 *
 * Çözücü `globalThis`te saklanıyor: Next sunucu kodunu rota başına ayrı
 * paketlere bölebiliyor ve modül düzeyi bir değişken her pakette yeniden
 * doğardı — kayıt bir pakette yapılıp başka pakette okunamazdı.
 *
 * ⚠️ İstemci bileşenleri bu modülü İÇE AKTARMAZ: dil kaydını, yani bütün dil
 * dosyalarını çekiyor. İstemci için `client.tsx` ve `lookup.ts` var.
 */

import { SOURCE_LOCALE, type Dictionary, type Locale } from "./locales.ts";
import { isLocale, localeDictionary } from "../../locales/index.ts";
import { createT, type MessageKey, type Params, type TFunction } from "./translate.ts";

/** Seçili dilin sözlüğü, eksikleri kaynak dille doldurulmuş. */
export function getDictionary(locale: Locale): Dictionary {
  return localeDictionary(locale);
}

const RESOLVER: unique symbol = Symbol.for("panel.i18n.locale-resolver");

type Holder = { [RESOLVER]?: () => Locale };

function holder(): Holder {
  return globalThis as unknown as Holder;
}

export function setLocaleResolver(resolve: () => Locale): void {
  holder()[RESOLVER] = resolve;
}

/** O anda seçili dil. Çözücü kayıtlı değilse, patlarsa ya da dil bilinmiyorsa Türkçe. */
export function currentLocale(): Locale {
  try {
    const locale = holder()[RESOLVER]?.();
    return isLocale(locale) ? locale : SOURCE_LOCALE;
  } catch {
    return SOURCE_LOCALE;
  }
}

/** O anki dilin sözlüğü — sunucu tarafı biçimleyiciler (`format.ts`) için. */
export function currentDictionary(): Dictionary {
  return localeDictionary(currentLocale());
}

// Dil başına tek `t`: sıcak yollarda (metrik döngüsü, olay akışı) her çağrıda
// yeniden kurmak gereksiz iş demek.
const cache = new Map<Locale, TFunction>();

export function translator(locale: Locale): TFunction {
  const cached = cache.get(locale);
  if (cached) return cached;
  const fresh = createT(localeDictionary(locale));
  cache.set(locale, fresh);
  return fresh;
}

/** Sunucu tarafı çeviri: `serverT("common.errors.generic")`. */
export function serverT(key: MessageKey, params?: Params): string {
  return translator(currentLocale())(key, params);
}
