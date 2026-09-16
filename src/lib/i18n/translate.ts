/**
 * Çeviri çekirdeği — saf, bağımlılıksız, test edilebilir.
 *
 * Sözlükte gezinme dize anahtarla yapılıyor ("shell.logout"), ama anahtar tipi
 * sözlükten TÜRETİLİYOR: olmayan bir anahtar yazmak derleme hatası. Çevirinin
 * asıl riski budur — metin eksik kalırsa ekranda ancak gözle fark edilir.
 */

import { intlLocale, type Locale } from "./locales.ts";

/** Çoğul biçimli metin. İngilizce "1 day"/"2 days" ayrımı için. */
export type Plural = { one: string; other: string };

export type DictNode = string | Plural | { [key: string]: DictNode };

export type Params = Record<string, string | number>;

/** Sözlükteki tüm yaprakların noktalı yolu: "shell.menu.close" gibi. */
export type DotPath<T> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : T[K] extends Plural
      ? K
      : `${K}.${DotPath<T[K]>}`;
}[keyof T & string];

export type TFunction<D> = (key: DotPath<D>, params?: Params) => string;

function lookup(dict: unknown, key: string): DictNode | undefined {
  let node: unknown = dict;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node as DictNode | undefined;
}

/** `{name}` yer tutucularını doldurur; karşılığı olmayanı olduğu gibi bırakır. */
function interpolate(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

function isPlural(node: DictNode): node is Plural {
  return typeof node === "object" && node !== null && "other" in node;
}

/**
 * Tip denetimi olmayan sürüm — sözlüğü dışarıdan alan `format.ts` gibi
 * yardımcılar için. Uygulama kodu bunu DEĞİL, `createT`yi kullanır.
 */
export function translateLoose(
  dict: unknown,
  locale: Locale,
  key: string,
  params?: Params,
): string {
  const node = lookup(dict, key);

  if (typeof node === "string") return interpolate(node, params);

  if (node !== undefined && isPlural(node)) {
    const count = Number(params?.count ?? 0);
    const rule = new Intl.PluralRules(intlLocale(locale)).select(count);
    const form = rule === "one" ? node.one : node.other;
    return interpolate(form, params);
  }

  // Anahtar bulunamadı: ekranda anahtarın kendisi görünür. Boş dize döndürmek,
  // eksik çeviriyi "bu alan zaten boştu" gibi gösterir ve gizlerdi.
  return key;
}

export function createT<D>(dict: D, locale: Locale): TFunction<D> {
  return (key, params) => translateLoose(dict, locale, key as string, params);
}
