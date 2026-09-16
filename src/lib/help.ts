/**
 * Sayfa yardımının ARAMA mantığı.
 *
 * Metinlerin kendisi burada değil, sözlükte (`lib/i18n/dict/*​/help.ts`): bir
 * ekranın ne yaptığı da çevrilmesi gereken bir metin ve iki dili tek dosyada
 * tutmak ikisinin zamanla ayrışması demekti. Burada kalan tek şey "hangi yol
 * hangi kaydı alır" kuralı.
 */

import type { Dictionary } from "@/lib/i18n/dict/tr";

export type HelpEntry = {
  /** Bu ekran ne işe yarar. */
  amac: string;
  /** Arkada ne dönüyor — veriyi nereden alıyor, ne zaman güncelleniyor. */
  nasil: string;
  /** Bilinmesi gereken sınır ya da tuzak; yoksa boş. */
  dikkat?: string;
};

/**
 * Yol için yardım kaydı — en uzun ön ek kazanır.
 *
 * `/settings/docker` gibi alt yollar da `/settings` kaydını bulsun diye.
 * Kök `/` yalnızca tam eşleşmede kullanılıyor: aksi halde her yolun ön eki
 * olduğu için tüm sayfalar "Genel Bakış" metnini gösterirdi.
 */
export function helpFor(pathname: string, dict: Dictionary): HelpEntry | null {
  // Yollar çalışma zamanında geliyor; sözlüğün harf harf bilinen anahtar tipi
  // burada iş görmüyor, tek bir dönüşümle gevşetiliyor.
  const pageHelp = dict.help as Record<string, HelpEntry | undefined>;

  if (pathname === "/") return pageHelp["/"] ?? null;

  let best: string | null = null;
  for (const key of Object.keys(pageHelp)) {
    if (key === "/") continue;
    if (pathname === key || pathname.startsWith(`${key}/`)) {
      if (!best || key.length > best.length) best = key;
    }
  }
  return best ? pageHelp[best] ?? null : null;
}
