import "server-only";

import { readCache, writeCache } from "@/lib/db/cache";
import { isMockMode } from "@/lib/env";
import { getNumber, getString } from "@/lib/settings";

/**
 * M2.7 — hava durumu.
 *
 * Open-Meteo kullanılıyor: API anahtarı istemiyor. Anahtar gerektiren bir
 * servis seçseydik kullanıcının hesap açması, anahtarı panele girmesi ve
 * T3 ile şifrelenmesi gerekirdi — bir saat kartının yanındaki sıcaklık için
 * fazla ağır bir zincir.
 *
 * Sonuç önbelleğe alınıyor: hava 15 dakikada bir değişmez ve ana sayfa
 * saniyeler aralıkla yenileniyor.
 */

const CACHE_KEY = "home:weather";
const CACHE_TTL = 900;
const TIMEOUT_MS = 8_000;

export type Weather = {
  temperature: number;
  apparent: number;
  code: number;
  description: string;
  max: number;
  min: number;
  /** Ölçümün alındığı an (unix). */
  observedAt: number;
};

/**
 * WMO hava kodları.
 *
 * Yalnızca gruplar çevrildi, 100 kodun tamamı değil: "hafif çiseleyen yağmur"
 * ile "orta yoğunlukta çiseleyen yağmur" arasındaki farkın ana sayfada bir
 * karşılığı yok.
 */
function describe(code: number): string {
  if (code === 0) return "Açık";
  if (code <= 2) return "Az bulutlu";
  if (code === 3) return "Kapalı";
  if (code <= 48) return "Sisli";
  if (code <= 57) return "Çiseliyor";
  if (code <= 67) return "Yağmurlu";
  if (code <= 77) return "Karlı";
  if (code <= 82) return "Sağanak";
  if (code <= 86) return "Kar sağanağı";
  return "Fırtınalı";
}

type Payload = {
  current?: { temperature_2m?: number; apparent_temperature?: number; weather_code?: number };
  daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[] };
};

export function weatherEnabled(): boolean {
  // Enlem/boylam ikisi de 0 ise ayar hiç doldurulmamış demektir; Gine
  // Körfezi'ndeki bir noktanın hava durumunu göstermenin anlamı yok.
  return getNumber("home.latitude") !== 0 || getNumber("home.longitude") !== 0;
}

export async function currentWeather(): Promise<
  { ok: true; weather: Weather; updatedAt: number } | { ok: false; error: string }
> {
  if (!weatherEnabled()) return { ok: false, error: "konum ayarlanmamış" };

  const cached = readCache<Weather>(CACHE_KEY);
  const now = Math.floor(Date.now() / 1000);
  if (cached && now - cached.updatedAt < CACHE_TTL) {
    return { ok: true, weather: cached.value, updatedAt: cached.updatedAt };
  }

  if (isMockMode()) {
    const weather: Weather = {
      temperature: 24.3,
      apparent: 25.1,
      code: 2,
      description: describe(2),
      max: 29.0,
      min: 18.4,
      observedAt: now,
    };
    writeCache(CACHE_KEY, weather);
    return { ok: true, weather, updatedAt: now };
  }

  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${getNumber("home.latitude")}&longitude=${getNumber("home.longitude")}` +
    "&current=temperature_2m,apparent_temperature,weather_code" +
    "&daily=temperature_2m_max,temperature_2m_min" +
    `&timezone=${encodeURIComponent(getString("general.timezone") || "auto")}`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = (await response.json()) as Payload;
    const code = payload.current?.weather_code ?? 0;

    const weather: Weather = {
      temperature: payload.current?.temperature_2m ?? 0,
      apparent: payload.current?.apparent_temperature ?? 0,
      code,
      description: describe(code),
      max: payload.daily?.temperature_2m_max?.[0] ?? 0,
      min: payload.daily?.temperature_2m_min?.[0] ?? 0,
      observedAt: now,
    };

    writeCache(CACHE_KEY, weather);
    return { ok: true, weather, updatedAt: now };
  } catch (error) {
    // Eldeki eski veri hiç veriden iyidir; yaşı çağıran tarafa bildiriliyor.
    if (cached) return { ok: true, weather: cached.value, updatedAt: cached.updatedAt };
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
