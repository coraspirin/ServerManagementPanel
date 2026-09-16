/**
 * Anahtarı ÇALIŞMA ZAMANINDA oluşan metinlerin okunması.
 *
 * Ayar kategorileri, ayarların kendisi, işler ve sayfa yardımları şemadan ya
 * da yoldan türeyen anahtarlarla okunuyor; `t()`nin derleme anında bilinen
 * anahtar tipi burada işlemiyor.
 *
 * İstemci bileşenleri de kullanıyor: bu modül dil dosyası İÇE AKTARMAZ,
 * sözlüğü parametre olarak alır.
 */

import type { Dictionary } from "./locales.ts";

/** Ayar kategorisinin adı ve açıklaması; sözlükte yoksa `null`. */
export function settingsGroupText(
  dict: Dictionary,
  key: string,
): { label: string; description: string } | null {
  const label = dict[`settings.groups.${key}.label`];
  if (label === undefined) return null;
  return { label, description: dict[`settings.groups.${key}.description`] ?? "" };
}

/** Tek bir ayarın adı, yardımı ve birimi. */
export type SettingItemText = {
  label: string;
  help?: string;
  unit?: string;
};

export function settingItemText(dict: Dictionary, key: string): SettingItemText | null {
  const label = dict[`settings.items.${key}.label`];
  if (label === undefined) return null;
  return {
    label,
    help: dict[`settings.items.${key}.help`],
    unit: dict[`settings.items.${key}.unit`],
  };
}

/**
 * Enum seçeneğinin adı. Seçeneklerin LİSTESİ şemada duruyor; burada yalnızca
 * tek bir değerin adı aranıyor — sözlükte önek taraması gerekmiyor.
 */
export function settingOptionText(dict: Dictionary, key: string, value: string): string | null {
  return dict[`settings.items.${key}.options.${value}`] ?? null;
}

/** Kategori içindeki alt başlık; bildirim kanallarında kanalın adı. */
export function settingSectionText(dict: Dictionary, key: string): string | null {
  return dict[`settings.sections.${key}`] ?? null;
}

/** Bir arka plan işinin adı ve açıklaması. */
export function jobText(
  dict: Dictionary,
  key: string,
): { label: string; description: string } | null {
  const label = dict[`jobs.items.${key}.label`];
  if (label === undefined) return null;
  return { label, description: dict[`jobs.items.${key}.description`] ?? "" };
}

const helpRouteCache = new WeakMap<Dictionary, string[]>();

/**
 * Yardımı yazılmış yollar ("/docker", "/settings"…).
 *
 * Sözlük düz olduğu için bu liste anahtarlardan çıkarılıyor; sözlük nesnesi
 * başına bir kez hesaplanıp saklanıyor, her render'da taranmıyor.
 */
export function helpRoutes(dict: Dictionary): string[] {
  const cached = helpRouteCache.get(dict);
  if (cached) return cached;

  const routes = Object.keys(dict)
    .map((key) => /^help\.(\/.*)\.amac$/.exec(key)?.[1])
    .filter((route): route is string => route !== undefined);

  helpRouteCache.set(dict, routes);
  return routes;
}
