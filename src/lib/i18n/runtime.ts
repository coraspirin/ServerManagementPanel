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
 */

import { DEFAULT_LOCALE, type Locale } from "./locales.ts";
import { en } from "./dict/en/index.ts";
import { tr, type Dictionary } from "./dict/tr/index.ts";
import { createT, type DotPath, type Params, type TFunction } from "./translate.ts";

export function getDictionary(locale: Locale): Dictionary {
  return locale === "en" ? en : tr;
}

const RESOLVER: unique symbol = Symbol.for("panel.i18n.locale-resolver");

type Holder = { [RESOLVER]?: () => Locale };

function holder(): Holder {
  return globalThis as unknown as Holder;
}

export function setLocaleResolver(resolve: () => Locale): void {
  holder()[RESOLVER] = resolve;
}

/** O anda seçili dil. Çözücü kayıtlı değilse ya da patlarsa Türkçe. */
export function currentLocale(): Locale {
  try {
    return holder()[RESOLVER]?.() ?? DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

// Dil başına tek `t`: her çağrıda yeni Intl.PluralRules kurmak, sıcak yollarda
// (metrik döngüsü, olay akışı) gereksiz iş demek.
const cache = new Map<Locale, TFunction<Dictionary>>();

export function translator(locale: Locale): TFunction<Dictionary> {
  const cached = cache.get(locale);
  if (cached) return cached;
  const fresh = createT(getDictionary(locale), locale);
  cache.set(locale, fresh);
  return fresh;
}

/** Sunucu tarafı çeviri: `serverT("common.errors.generic")`. */
export function serverT(key: DotPath<Dictionary>, params?: Params): string {
  return translator(currentLocale())(key, params);
}

/**
 * Ayar kategorisinin adı ve açıklaması.
 *
 * Anahtar ÇALIŞMA ZAMANINDA belli oluyor (`settings.schema.ts`teki grup
 * anahtarı), bu yüzden `t()`nin harf harf bilinen yol tipi burada işlemiyor;
 * tek bir yerde, tek bir dönüşümle çözülüyor. Sözlükte karşılığı yoksa `null`:
 * çağıran taraf anahtarın kendisini göstermeyi seçebilir.
 */
export function settingsGroupText(
  dict: Dictionary,
  key: string,
): { label: string; description: string } | null {
  const groups = dict.settings.groups as Record<string, { label: string; description: string }>;
  return groups[key] ?? null;
}

/** Tek bir ayarın adı, yardımı, birimi ve enum seçeneklerinin adları. */
export type SettingItemText = {
  label: string;
  help?: string;
  unit?: string;
  options?: Record<string, string>;
};

export function settingItemText(dict: Dictionary, key: string): SettingItemText | null {
  const items = dict.settings.items as Record<string, SettingItemText>;
  return items[key] ?? null;
}

/** Bir arka plan işinin adı ve açıklaması. */
export function jobText(
  dict: Dictionary,
  key: string,
): { label: string; description: string } | null {
  const items = dict.jobs.items as Record<string, { label: string; description: string }>;
  return items[key] ?? null;
}

/** Kategori içindeki alt başlık; bildirim kanallarında kanalın adı. */
export function settingSectionText(dict: Dictionary, key: string): string | null {
  const sections = dict.settings.sections as Record<string, string>;
  return sections[key] ?? null;
}
