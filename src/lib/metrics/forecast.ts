import "server-only";

import { getDb } from "@/lib/db/client";
import { getNumber } from "@/lib/settings";

/**
 * M1.5 — kapasite tahmini.
 *
 * "Disk N gün sonra dolar" sorusuna en küçük kareler doğrusuyla cevap verir.
 * Basit ama DÜRÜST olması için üç koruma var:
 *
 *   1. Yeterli geçmiş yoksa tahmin YAPILMAZ. İki saatlik veriden "3 gün sonra
 *      dolar" demek, bir dosya kopyalamayı felakete çevirmek olur.
 *   2. Uyum iyi değilse (R² düşük) tahmin gösterilir ama ALARM ÜRETMEZ.
 *      Zıplayan bir seri düz çizgiye oturmaz; oturmuş gibi davranmak yanlış
 *      alarm demektir.
 *   3. Eğim sıfır ya da negatifse tahmin yok — disk dolmuyor, boşalıyor.
 *
 * Veri günlük ortalamalardan (`metrics_1d`) okunur; saatlik dalgalanma
 * trendi bozar, günlük ortalama gerçek eğilimi verir.
 */

export type Forecast = {
  metric: string;
  /** Disk için bağlama noktası. */
  label: string;
  currentPct: number;
  /** Günde kaç puan artıyor (yüzde puanı/gün). */
  slopePerDay: number;
  /** %100'e ulaşacağı an (unix saniye); dolmuyorsa null. */
  fullAt: number | null;
  daysToFull: number | null;
  /** 0–1 arası uyum iyiliği (R²). */
  confidence: number;
  basedOnDays: number;
  /** Tahmin neden yapılamadı — kullanıcıya gösterilir. */
  reason: string | null;
};

type Point = { ts: number; value: number };

/** En küçük kareler: y = a + b·x. */
function linearFit(points: Point[]): { intercept: number; slope: number; r2: number } {
  const n = points.length;
  const meanX = points.reduce((sum, p) => sum + p.ts, 0) / n;
  const meanY = points.reduce((sum, p) => sum + p.value, 0) / n;

  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const point of points) {
    const dx = point.ts - meanX;
    const dy = point.value - meanY;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }

  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = meanY - slope * meanX;
  const r2 = syy === 0 || sxx === 0 ? 0 : (sxy * sxy) / (sxx * syy);

  return { intercept, slope, r2 };
}

function history(metric: string, label: string, days: number): Point[] {
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  return getDb()
    .prepare(
      `SELECT ts, avg_value AS value FROM metrics_1d
       WHERE host_id = 1 AND metric = ? AND label = ? AND ts >= ?
       ORDER BY ts`,
    )
    .all(metric, label, since) as Point[];
}

function forecastFor(metric: string, label: string): Forecast {
  const windowDays = getNumber("capacity.window_days");
  const minDays = getNumber("capacity.min_history_days");
  const minConfidence = getNumber("capacity.min_confidence") / 100;

  const points = history(metric, label, windowDays);
  const base: Forecast = {
    metric,
    label,
    currentPct: points.length > 0 ? points[points.length - 1].value : 0,
    slopePerDay: 0,
    fullAt: null,
    daysToFull: null,
    confidence: 0,
    basedOnDays: points.length,
    reason: null,
  };

  if (points.length < minDays) {
    return {
      ...base,
      reason: `Tahmin için en az ${minDays} günlük geçmiş gerekiyor (şu an ${points.length} gün).`,
    };
  }

  const { intercept, slope, r2 } = linearFit(points);
  const slopePerDay = slope * 86400;

  if (slopePerDay <= 0.001) {
    return { ...base, slopePerDay, confidence: r2, reason: "Doluluk artmıyor." };
  }

  // Doğrunun 100'e ulaştığı an: 100 = intercept + slope·t  →  t = (100 - a) / b
  const fullAt = Math.round((100 - intercept) / slope);
  const daysToFull = (fullAt - Math.floor(Date.now() / 1000)) / 86400;

  return {
    ...base,
    slopePerDay,
    confidence: r2,
    fullAt,
    daysToFull: daysToFull > 0 ? daysToFull : 0,
    reason:
      r2 < minConfidence
        ? `Veri düz bir eğilim göstermiyor (uyum %${Math.round(r2 * 100)}) — tahmin bilgi amaçlı, alarm üretmiyor.`
        : null,
  };
}

/** İzlenen her disk bölümü için tahmin. */
export function diskForecasts(): Forecast[] {
  const mounts = getDb()
    .prepare(
      `SELECT DISTINCT label FROM metrics_1d
       WHERE metric = 'disk.used_pct' AND host_id = 1 ORDER BY label`,
    )
    .all() as { label: string }[];

  return mounts.map((row) => forecastFor("disk.used_pct", row.label));
}

/** Alarm üretilebilir mi — yeterli geçmiş ve yeterli uyum var mı? */
export function isActionable(forecast: Forecast): boolean {
  return (
    forecast.daysToFull !== null &&
    forecast.reason === null &&
    forecast.confidence >= getNumber("capacity.min_confidence") / 100
  );
}
