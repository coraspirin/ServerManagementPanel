import { TrendingUp } from "lucide-react";
import type { Forecast } from "@/lib/metrics/forecast";
import { formatPct } from "@/lib/i18n/format";
import { getActiveDictionary, getT } from "@/lib/i18n/server";
import type { TFunction } from "@/lib/i18n/translate";

/**
 * Kapasite tahmini paneli (M1.5).
 *
 * Tahminin GÜVENİLİRLİĞİ değerin kendisi kadar önemli: kaç günlük veriye
 * dayandığı ve uyumun ne kadar iyi olduğu her satırda yazıyor. "45 gün sonra
 * dolar" cümlesi, arkasında 5 günlük zıplayan veri varsa yanıltıcıdır.
 */

function formatDays(days: number, t: TFunction): string {
  if (days < 1) return t("capacity.today");
  if (days < 30) return t("capacity.days", { count: Math.round(days) });
  if (days < 365) return t("capacity.months", { count: Math.round(days / 30) });
  return t("capacity.years", { count: (days / 365).toFixed(1) });
}

function urgencyClass(days: number, horizon: number): string {
  if (days <= horizon / 2) return "text-danger";
  if (days <= horizon) return "text-warn";
  return "text-ink";
}

export function CapacityPanel({
  forecasts,
  horizonDays,
}: {
  forecasts: Forecast[];
  horizonDays: number;
}) {
  if (forecasts.length === 0) return null;
  const t = getT();
  const dict = getActiveDictionary();

  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 font-semibold">
          <TrendingUp className="size-4" /> {t("capacity.title")}
        </h2>
        <span className="text-xs text-subtle">{t("capacity.horizon", { count: horizonDays })}</span>
      </div>

      <div className="mt-4 space-y-3">
        {forecasts.map((forecast) => (
          <div key={`${forecast.metric}-${forecast.label}`} className="text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-mono text-xs">{forecast.label}</span>
              {forecast.daysToFull === null ? (
                <span className="text-xs text-subtle">{t("capacity.noForecast")}</span>
              ) : (
                <span
                  className={`text-xs font-medium ${urgencyClass(forecast.daysToFull, horizonDays)}`}
                >
                  {t("capacity.fullIn", { when: formatDays(forecast.daysToFull, t) })}
                </span>
              )}
            </div>

            <p className="mt-0.5 text-xs text-subtle">
              {t("capacity.current", { pct: formatPct(forecast.currentPct, dict, 1) })}
              {forecast.slopePerDay > 0.001 &&
                t("capacity.slope", { value: forecast.slopePerDay.toFixed(2) })}
              {forecast.basedOnDays > 0 &&
                t("capacity.basis", {
                  days: forecast.basedOnDays,
                  fit: formatPct(Math.round(forecast.confidence * 100), dict, 0),
                })}
            </p>

            {forecast.reason && (
              <p className="mt-0.5 text-[11px] text-warn">{forecast.reason}</p>
            )}
          </div>
        ))}
      </div>

      <p className="mt-4 text-[11px] text-subtle">
        {t("capacity.note")}
      </p>
    </section>
  );
}
