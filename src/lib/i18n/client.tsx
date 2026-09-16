"use client";

/**
 * İstemci tarafı çeviri.
 *
 * Sözlük prop olarak geliyor, modülden içe AKTARILMIYOR: ikisini de import
 * etseydik her iki dilin tüm metni istemci paketine girerdi. Kök layout yalnızca
 * seçili dili gönderiyor.
 */

import { createContext, useContext, useMemo } from "react";
import type { Dictionary } from "./dict/tr/index.ts";
import type { Locale } from "./locales.ts";
import { createT, translateLoose, type Params, type TFunction } from "./translate.ts";
import {
  compareText,
  formatDate,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPct,
  formatRelative,
  formatTime,
  formatUptime,
  type DateInput,
} from "./format.ts";

type I18nValue = { locale: Locale; dict: Dictionary };

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({
  locale,
  dict,
  children,
}: I18nValue & { children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, dict }), [locale, dict]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  // Sağlayıcı kök layout'ta; buraya düşmek "bileşen panel ağacının dışında
  // render ediliyor" demek ve sessizce Türkçeye düşmek yerine bağırmalı.
  if (!value) throw new Error("I18nProvider bulunamadı — bileşen ağacın dışında.");
  return value;
}

export function useLocale(): Locale {
  return useI18n().locale;
}

export function useT(): TFunction<Dictionary> {
  const { locale, dict } = useI18n();
  return useMemo(() => createT(dict, locale), [dict, locale]);
}

/** Seçili dilin sözlüğü — anahtarı elle aramak gerektiğinde. */
export function useDict(): Dictionary {
  return useI18n().dict;
}

/**
 * Anahtarı ÇALIŞMA ZAMANINDA belli olan metinler için — menü maddeleri, ayar
 * kategorileri. `useT` burada işlemiyor: anahtarı derleme anında bilmiyoruz.
 *
 * Karşılığı olmayan anahtar ekranda anahtarın kendisi olarak görünür; sessizce
 * boş bırakmaktan iyidir.
 */
export function useDynamicT(): (key: string, params?: Params) => string {
  const { locale, dict } = useI18n();
  return useMemo(
    () => (key: string, params?: Params) => translateLoose(dict, locale, key, params),
    [dict, locale],
  );
}

/**
 * Dile bağlı biçimleyiciler, seçili dile bağlanmış hâlde.
 *
 * Çağrı yerinde `f.date(x)` yazmak, her seferinde dili elden geçirmekten hem
 * kısa hem de unutmaya kapalı.
 */
export function useFormat() {
  const { locale, dict } = useI18n();

  return useMemo(
    () => ({
      locale,
      date: (value: DateInput, options?: Intl.DateTimeFormatOptions) =>
        formatDate(value, locale, options),
      time: (value: DateInput, options?: Intl.DateTimeFormatOptions) =>
        formatTime(value, locale, options),
      dateTime: (value: DateInput, options?: Intl.DateTimeFormatOptions) =>
        formatDateTime(value, locale, options),
      number: (value: number, options?: Intl.NumberFormatOptions) =>
        formatNumber(value, locale, options),
      pct: (value: number, digits?: number) => formatPct(value, locale, digits),
      duration: (seconds: number) => formatDuration(seconds, locale, dict),
      uptime: (seconds: number) => formatUptime(seconds, locale, dict),
      relative: (value: DateInput) => formatRelative(value, locale, dict),
      compare: (a: string, b: string) => compareText(a, b, locale),
    }),
    [locale, dict],
  );
}
