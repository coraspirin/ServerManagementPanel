"use client";

/**
 * İstemci tarafı çeviri.
 *
 * Sözlük prop olarak geliyor, dil kaydından içe AKTARILMIYOR: kaydı import
 * etseydik bütün dillerin tüm metni istemci paketine girerdi. Kök layout
 * yalnızca seçili dilin sözlüğünü gönderiyor.
 */

import { createContext, useContext, useMemo } from "react";
import { intlOf, type Dictionary, type Locale } from "./locales.ts";
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
  formatMonth,
  formatWeekday,
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

export function useT(): TFunction {
  const { dict } = useI18n();
  return useMemo(() => createT(dict), [dict]);
}

/** Seçili dilin sözlüğü — `lookup.ts` yardımcılarına vermek için. */
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
  const { dict } = useI18n();
  return useMemo(() => (key: string, params?: Params) => translateLoose(dict, key, params), [dict]);
}

/**
 * Dile bağlı biçimleyiciler, seçili dile bağlanmış hâlde.
 *
 * Çağrı yerinde `f.date(x)` yazmak, her seferinde sözlüğü elden geçirmekten
 * hem kısa hem de unutmaya kapalı.
 */
export function useFormat() {
  const { locale, dict } = useI18n();

  return useMemo(
    () => ({
      locale,
      date: (value: DateInput, options?: Intl.DateTimeFormatOptions) =>
        formatDate(value, dict, options),
      time: (value: DateInput, options?: Intl.DateTimeFormatOptions) =>
        formatTime(value, dict, options),
      dateTime: (value: DateInput, options?: Intl.DateTimeFormatOptions) =>
        formatDateTime(value, dict, options),
      number: (value: number, options?: Intl.NumberFormatOptions) =>
        formatNumber(value, dict, options),
      pct: (value: number, digits?: number) => formatPct(value, dict, digits),
      duration: (seconds: number) => formatDuration(seconds, dict),
      uptime: (seconds: number) => formatUptime(seconds, dict),
      relative: (value: DateInput) => formatRelative(value, dict),
      compare: (a: string, b: string) => compareText(a, b, dict),
      weekday: (index: number, style?: "long" | "short") => formatWeekday(index, dict, style),
      month: (month: number) => formatMonth(month, dict),
      /** Aramada büyük/küçük harf eşitleme — Türkçede "İ"/"ı" kuralı dile bağlı. */
      lower: (text: string) => text.toLocaleLowerCase(intlOf(dict)),
    }),
    [locale, dict],
  );
}
