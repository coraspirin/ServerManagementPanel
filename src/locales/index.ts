/**
 * Dil kaydı — panelin bildiği diller.
 *
 * Her dil TEK bir JSON dosyası: düz, noktalı ve bağlamlı anahtarlar
 * (`"nav.items.host": "Sunucu"`). Türkçe KAYNAK dil: anahtar listesi ve `t()`
 * tipi ondan çıkıyor; başka bir dilde eksik kalan metin Türkçeye düşüyor.
 *
 * YENİ DİL elle eklenmez: `npm run i18n:new <kod> "<Görünen ad>" <intl>`
 * JSON taslağını üretir ve aşağıdaki işaretli iki bloğa kendisi yazar.
 *
 * JSON'lar STATİK içe aktarılıyor: çalışma anında klasör taramak, Next'in
 * standalone çıktısında dosyaları paketin dışında bırakırdı.
 *
 * İstemci bileşenleri buradan yalnızca TİP alabilir (`import type`). Değer
 * içe aktarmak bütün dillerin tüm metnini tarayıcı paketine taşır; istemci
 * sözlüğü kök layout'tan prop olarak alıyor.
 */

// i18n:imports
import en from "./en.json" with { type: "json" };
import tr from "./tr.json" with { type: "json" };
import de from "./de.json" with { type: "json" };
import fr from "./fr.json" with { type: "json" };
import it from "./it.json" with { type: "json" };
// i18n:imports-end

import { SOURCE_LOCALE, type Dictionary, type Locale } from "../lib/i18n/locales.ts";

/** Kaynak dilin anahtarları — `t()` çağrıları bunlara göre denetleniyor. */
export type SourceKey = keyof typeof tr;

const FILES: Record<Locale, Dictionary> = {
  // i18n:files
  en,
  tr,
  de,
  fr,
  it,
  // i18n:files-end
};

export type LocaleInfo = {
  code: Locale;
  /** Dilin kendi dilindeki adı: "Türkçe", "English", "Français". */
  name: string;
  intl: string;
  /** Çevirisi sürüyor: listede görünür, eksikleri test dışında kalır. */
  draft: boolean;
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && Object.hasOwn(FILES, value);
}

export function registeredLocales(): Locale[] {
  return Object.keys(FILES);
}

/** Dosyanın HAM içeriği, dolgusuz — denetim betiği ve testler için. */
export function rawLocale(code: Locale): Dictionary | undefined {
  return FILES[code];
}

/** Dil seçimi için liste: kaynak dil önce, diğerleri adına göre. */
export function availableLocales(): LocaleInfo[] {
  return Object.entries(FILES)
    .map(([code, dict]) => ({
      code,
      name: dict["_meta.name"] || code,
      intl: dict["_meta.intl"] || code,
      draft: dict["_meta.status"] === "draft",
    }))
    .sort((a, b) =>
      a.code === SOURCE_LOCALE ? -1 : b.code === SOURCE_LOCALE ? 1 : a.name.localeCompare(b.name),
    );
}

const merged = new Map<Locale, Dictionary>();

/**
 * Ekrana gidecek sözlük: dilin eksik anahtarları kaynak dille DOLDURULMUŞ.
 *
 * Doldurma burada, sunucuda yapılıyor ki istemci tek ve eksiksiz bir harita
 * alsın — tarayıcıya iki dili birden göndermeden ekrana ham anahtar düşmesin.
 * Bilinmeyen kod kaynak dile düşer.
 */
export function localeDictionary(code: Locale): Dictionary {
  const cached = merged.get(code);
  if (cached) return cached;

  const source = FILES[SOURCE_LOCALE];
  const own = FILES[code];
  const full = Object.freeze(own && code !== SOURCE_LOCALE ? { ...source, ...own } : { ...source });

  merged.set(code, full);
  return full;
}
