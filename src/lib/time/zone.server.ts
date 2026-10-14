import "server-only";

import { getString } from "@/lib/settings";
import { applyProcessTimeZone, isValidTimeZone, TIMEZONE_SETTING } from "./zone.ts";

/**
 * Ayardaki saat dilimi; okunamazsa ya da geçersizse sürecin dilimi
 * (`process.env.TZ`), o da yoksa undefined (çalışma ortamının yereli).
 * Kök layout her istekte çağırıyor; ayar okunamadığı için sayfanın
 * düşmemesi gerekiyor (kurulumdan önce DB boş olabilir).
 */
export function panelTimeZone(): string | undefined {
  try {
    const value = getString(TIMEZONE_SETTING);
    if (isValidTimeZone(value)) return value;
  } catch {
    // Ayar katmanı hazır değil — aşağıdaki geri dönüş.
  }
  return isValidTimeZone(process.env.TZ) ? process.env.TZ : undefined;
}

/** Açılışta ve ayar değişince: sürecin saat dilimini ayara eşitler. */
export function syncProcessTimeZone(): string | undefined {
  const zone = panelTimeZone();
  if (zone) applyProcessTimeZone(zone);
  return zone;
}
