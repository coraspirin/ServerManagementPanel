/**
 * Sayfa yardımının ARAMA mantığı.
 *
 * Metinlerin kendisi burada değil, dil dosyalarında (`src/locales/*.json`, `help.<yol>.*`): bir
 * ekranın ne yaptığı da çevrilmesi gereken bir metin ve iki dili tek dosyada
 * tutmak ikisinin zamanla ayrışması demekti. Burada kalan tek şey "hangi yol
 * hangi kaydı alır" kuralı.
 */

import type { Dictionary } from "@/lib/i18n/locales";
import { helpRoutes } from "@/lib/i18n/lookup";

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
  const routes = helpRoutes(dict);

  let best: string | null = null;
  if (pathname === "/") {
    best = routes.includes("/") ? "/" : null;
  } else {
    for (const route of routes) {
      if (route === "/") continue;
      if (pathname === route || pathname.startsWith(`${route}/`)) {
        if (!best || route.length > best.length) best = route;
      }
    }
  }
  if (!best) return null;

  return {
    amac: dict[`help.${best}.amac`],
    nasil: dict[`help.${best}.nasil`] ?? "",
    dikkat: dict[`help.${best}.dikkat`],
  };
}
