/**
 * Dile bağlı biçimleme — tarih, sayı, yüzde, süre, sıralama.
 *
 * Her yardımcı SÖZLÜĞÜ alıyor, dil kodunu değil: Intl etiketi (`_meta.intl`),
 * yüzde kalıbı (`format.percent`) ve süre birimleri dil dosyasında duruyor.
 * Böylece yeni bir dil kendi biçimini getiriyor; kodda "dil İngilizceyse"
 * diye dallanan bir satır yok.
 *
 * Türkçe çıktı eski "tr-TR" sabitli çağrılarla BİREBİR aynı kalıyor: dil
 * değişmediyse ekran da değişmemeli.
 */

import { intlOf, type Dictionary } from "./locales.ts";
import { translateLoose } from "./translate.ts";

export type DateInput = Date | number | string;

function toDate(value: DateInput): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(
  value: DateInput,
  dict: Dictionary,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
): string {
  const date = toDate(value);
  if (!date) return "—";
  return date.toLocaleDateString(intlOf(dict), options);
}

export function formatTime(
  value: DateInput,
  dict: Dictionary,
  options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" },
): string {
  const date = toDate(value);
  if (!date) return "—";
  return date.toLocaleTimeString(intlOf(dict), options);
}

export function formatDateTime(
  value: DateInput,
  dict: Dictionary,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = toDate(value);
  if (!date) return "—";
  return date.toLocaleString(intlOf(dict), options);
}

/**
 * Haftanın günü adı; 0 = Pazar (cron ve `Date.getDay` ile aynı sıra).
 *
 * Ad listesi dil dosyasında tutulmuyor: Intl her dilin gün adını zaten biliyor.
 */
export function formatWeekday(
  index: number,
  dict: Dictionary,
  style: "long" | "short" = "long",
): string {
  // 4 Ocak 1970 bir Pazar; UTC'de sabitlemek saat dilimi kaymasını önlüyor.
  return new Date(Date.UTC(1970, 0, 4 + index)).toLocaleDateString(intlOf(dict), {
    weekday: style,
    timeZone: "UTC",
  });
}

/** Ay adı; 1 = Ocak. */
export function formatMonth(month: number, dict: Dictionary): string {
  return new Date(Date.UTC(2000, month - 1, 1)).toLocaleDateString(intlOf(dict), {
    month: "long",
    timeZone: "UTC",
  });
}

export function formatNumber(
  value: number,
  dict: Dictionary,
  options?: Intl.NumberFormatOptions,
): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString(intlOf(dict), options);
}

/**
 * Yüzde. Kalıp dil dosyasında: Türkçe "%{value}" → "%42.5", İngilizce
 * "{value}%" → "42.5%".
 *
 * Ondalık ayırıcı bilerek `toFixed`ten geliyor, Intl'den değil: Intl Türkçede
 * virgül üretir ve paneldeki tüm yüzdeler bir anda "42,5"e dönerdi.
 */
export function formatPct(value: number, dict: Dictionary, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return translateLoose(dict, "format.percent", { value: value.toFixed(digits) });
}

/** Sıralama. Türkçe alfabe (ç, ğ, ı, ö, ş, ü) kendi sırasını dayatır. */
export function compareText(a: string, b: string, dict: Dictionary): number {
  return a.localeCompare(b, intlOf(dict));
}

/** Uzun süre: "2 gün 3 saat" / "2 days 3 hours". Birimler çoğul biçimli. */
export function formatDuration(seconds: number, dict: Dictionary): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";

  const unit = (name: string, count: number) =>
    translateLoose(dict, `common.duration.${name}`, { count });

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${unit("day", days)} ${unit("hour", hours)}`;
  if (hours > 0) return `${unit("hour", hours)} ${unit("minute", minutes)}`;
  return unit("minute", minutes);
}

/** Kısa çalışma süresi: "45 sn" / "45s" — container satırları için. */
export function formatUptime(seconds: number, dict: Dictionary): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";

  const unit = (name: string, count: number) =>
    translateLoose(dict, `common.durationShort.${name}`, { count });

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
export function formatRelative(value: DateInput, dict: Dictionary): string {
  const date = toDate(value);
  if (!date) return "—";

  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  const ago = (name: string, count: number) =>
    translateLoose(dict, `common.relative.${name}`, { count });

  // Gelecekteki damga: saat farkı ya da az önce yazılmış bir kayıt. İkisinde de
  // "az önce" doğru cevap; "-3 dk önce" yazmaktan iyidir.
  if (seconds < 60) return ago("now", 0);
  if (seconds < 3600) return ago("minutes", Math.floor(seconds / 60));
  if (seconds < 86400) return ago("hours", Math.floor(seconds / 3600));
  if (seconds < 2592000) return ago("days", Math.floor(seconds / 86400));
  return formatDate(date, dict);
}
