/**
 * Çeviri çekirdeği — saf, bağımlılıksız, test edilebilir.
 *
 * Anahtar tipi Türkçe dil dosyasından TÜRETİLİYOR: olmayan bir anahtar yazmak
 * derleme hatası. Çevirinin asıl riski budur — metin eksik kalırsa ekranda
 * ancak gözle fark edilir.
 */

import { intlOf, type Dictionary } from "./locales.ts";
// Yalnızca TİP: değer içe aktarmak dil dosyalarını istemci paketine taşırdı.
import type { SourceKey } from "../../locales/index.ts";

export type Params = Record<string, string | number>;

/**
 * Çoğul biçimler dosyada son eklerle duruyor ("common.duration.day.one" /
 * ".other"); çağrı yerinde son eksiz yazılıyor: `t("common.duration.day")`.
 */
type StripPlural<K> = K extends `${infer Base}.one`
  ? Base
  : K extends `${infer Base}.other`
    ? Base
    : K;

export type MessageKey = StripPlural<SourceKey>;

export type TFunction = (key: MessageKey, params?: Params) => string;

/**
 * Yer tutucu: `{name}`. Önünde `$` olan `${NAME}` yer tutucu DEĞİL — metnin
 * kendisi (compose/kabuk değişkeni sözdizimi yardım metinlerinde geçiyor) ve
 * olduğu gibi gösterilir. Denetleyici (`check.ts`) aynı kuralı kullanıyor.
 */
export const PLACEHOLDER = /(?<!\$)\{(\w+)\}/g;

/** Yer tutucuları doldurur; karşılığı olmayanı olduğu gibi bırakır. */
function interpolate(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(PLACEHOLDER, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/**
 * Tip denetimi olmayan sürüm — anahtarı çalışma zamanında oluşan metinler
 * (menü, ayar kategorileri) ve sözlüğü dışarıdan alan yardımcılar için.
 * Uygulama kodu mümkün olduğunda `createT`yi kullanır.
 */
export function translateLoose(dict: Dictionary, key: string, params?: Params): string {
  const exact: string | undefined = dict[key];
  if (exact !== undefined) return interpolate(exact, params);

  // Çoğul: dilin kuralı kategoriyi seçer. Dosyada o kategori yoksa "other".
  // Kategoriler dile göre değişiyor (Türkçede one/other, Lehçede few/many de
  // var) — yeni bir dil kendi kategorilerini son ek olarak ekleyebilir.
  const other: string | undefined = dict[`${key}.other`];
  if (other !== undefined) {
    const count = Number(params?.count ?? 0);
    const category = new Intl.PluralRules(intlOf(dict)).select(count);
    const form: string | undefined = dict[`${key}.${category}`];
    return interpolate(form ?? other, params);
  }

  // Anahtar bulunamadı: ekranda anahtarın kendisi görünür. Boş dize döndürmek,
  // eksik çeviriyi "bu alan zaten boştu" gibi gösterir ve gizlerdi.
  return key;
}

export function createT(dict: Dictionary): TFunction {
  return (key, params) => translateLoose(dict, key, params);
}
