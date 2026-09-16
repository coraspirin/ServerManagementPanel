/**
 * Dile bağlı biçimleme — tarih, sayı, süre, sıralama.
 *
 * Panelde bu değerler bugüne dek "tr-TR" sabitiyle üretiliyordu. Buradaki
 * yardımcılar Türkçe çıktıyı BİREBİR korur (bilerek: dil değişmediyse ekran da
 * değişmemeli), İngilizcede ise yerel biçime geçer.
 *
 * Metin gereken yerlerde sözlük dışarıdan veriliyor; bu modül hangi dilin
 * seçili olduğunu kendisi aramaz.
 */

import { intlLocale, type Locale } from "./locales.ts";
import { translateLoose } from "./translate.ts";

export type DateInput = Date | number | string;

function toDate(value: DateInput): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(
  value: DateInput,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
): string {
  const date = toDate(value);
  if (!date) return "—";
  return date.toLocaleDateString(intlLocale(locale), options);
}

export function formatTime(
  value: DateInput,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" },
): string {
  const date = toDate(value);
  if (!date) return "—";
  return date.toLocaleTimeString(intlLocale(locale), options);
}

export function formatDateTime(
  value: DateInput,
  locale: Locale,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = toDate(value);
  if (!date) return "—";
  return date.toLocaleString(intlLocale(locale), options);
}

export function formatNumber(
  value: number,
  locale: Locale,
  options?: Intl.NumberFormatOptions,
): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString(intlLocale(locale), options);
}

/**
 * Yüzde. Türkçede işaret ÖNDE ("%42.5"), İngilizcede ARKADA ("42.5%").
 *
 * Ondalık ayırıcı bilerek `toFixed`ten geliyor, Intl'den değil: Intl Türkçede
 * virgül üretir ve paneldeki tüm yüzdeler bir anda "42,5"e dönerdi.
 */
export function formatPct(value: number, locale: Locale, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  const text = value.toFixed(digits);
  return locale === "en" ? `${text}%` : `%${text}`;
}

/** Sıralama. Türkçe alfabe (ç, ğ, ı, ö, ş, ü) kendi sırasını dayatır. */
export function compareText(a: string, b: string, locale: Locale): number {
  return a.localeCompare(b, intlLocale(locale));
}

/**
 * Uzun süre: "2 gün 3 saat" / "2 days 3 hours".
 *
 * Birim metinleri sözlükten geliyor ve çoğul biçimli — İngilizcede "1 day" ile
 * "2 days" ayrımı var, Türkçede tek biçim.
 */
export function formatDuration(seconds: number, locale: Locale, dict: unknown): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";

  const unit = (name: string, count: number) =>
    translateLoose(dict, locale, `common.duration.${name}`, { count });

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${unit("day", days)} ${unit("hour", hours)}`;
  if (hours > 0) return `${unit("hour", hours)} ${unit("minute", minutes)}`;
  return unit("minute", minutes);
}

/** Kısa çalışma süresi: "45 sn" / "45 sec" — container satırları için. */
export function formatUptime(seconds: number, locale: Locale, dict: unknown): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";

  const unit = (name: string, count: number) =>
    translateLoose(dict, locale, `common.durationShort.${name}`, { count });

  if (seconds < 60) return unit("second", Math.floor(seconds));

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${unit("day", days)} ${unit("hour", hours)}`;
  if (hours > 0) return `${unit("hour", hours)} ${unit("minute", minutes)}`;
  return unit("minute", minutes);
}

/**
 * Geçmiş zaman: "5 dk önce" / "5 min ago".
 *
 * `Intl.RelativeTimeFormat` DEĞİL, sözlük kullanılıyor: Intl Türkçede
 * "5 dakika önce" üretir, paneldeki yerleşik kısaltma ise "5 dk önce".
 */
export function formatRelative(value: DateInput, locale: Locale, dict: unknown): string {
  const date = toDate(value);
  if (!date) return "—";

  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  const ago = (name: string, count: number) =>
    translateLoose(dict, locale, `common.relative.${name}`, { count });

  // Gelecekteki damga: saat farkı ya da az önce yazılmış bir kayıt. İkisinde de
  // "az önce" doğru cevap; "-3 dk önce" yazmaktan iyidir.
  if (seconds < 60) return ago("now", 0);
  if (seconds < 3600) return ago("minutes", Math.floor(seconds / 60));
  if (seconds < 86400) return ago("hours", Math.floor(seconds / 3600));
  if (seconds < 2592000) return ago("days", Math.floor(seconds / 86400));
  return formatDate(date, locale);
}
