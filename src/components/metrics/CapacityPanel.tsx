import { TrendingUp } from "lucide-react";
import type { Forecast } from "@/lib/metrics/forecast";

/**
 * Kapasite tahmini paneli (M1.5).
 *
 * Tahminin GÜVENİLİRLİĞİ değerin kendisi kadar önemli: kaç günlük veriye
 * dayandığı ve uyumun ne kadar iyi olduğu her satırda yazıyor. "45 gün sonra
 * dolar" cümlesi, arkasında 5 günlük zıplayan veri varsa yanıltıcıdır.
 */

function formatDays(days: number): string {
  if (days < 1) return "bugün";
  if (days < 30) return `${Math.round(days)} gün`;
  if (days < 365) return `~${Math.round(days / 30)} ay`;
  return `~${(days / 365).toFixed(1)} yıl`;
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

  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 font-semibold">
          <TrendingUp className="size-4" /> Kapasite tahmini
        </h2>
        <span className="text-xs text-subtle">uyarı ufku: {horizonDays} gün</span>
      </div>

      <div className="mt-4 space-y-3">
        {forecasts.map((forecast) => (
          <div key={`${forecast.metric}-${forecast.label}`} className="text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-mono text-xs">{forecast.label}</span>
              {forecast.daysToFull === null ? (
                <span className="text-xs text-subtle">tahmin yok</span>
              ) : (
                <span
                  className={`text-xs font-medium ${urgencyClass(forecast.daysToFull, horizonDays)}`}
                >
                  {formatDays(forecast.daysToFull)} sonra dolabilir
                </span>
              )}
            </div>

            <p className="mt-0.5 text-xs text-subtle">
              Şu an %{forecast.currentPct.toFixed(1)}
              {forecast.slopePerDay > 0.001 && (
                <> · günde {forecast.slopePerDay.toFixed(2)} puan artıyor</>
              )}
              {forecast.basedOnDays > 0 && (
                <>
                  {" "}
                  · {forecast.basedOnDays} günlük veri · uyum %
                  {Math.round(forecast.confidence * 100)}
                </>
              )}
            </p>

            {forecast.reason && (
              <p className="mt-0.5 text-[11px] text-warn">{forecast.reason}</p>
            )}
          </div>
        ))}
      </div>

      <p className="mt-4 text-[11px] text-subtle">
        Tahmin, günlük ortalamalara oturtulan bir doğrudan gelir. Yeterli geçmiş
        yoksa ya da veri düz bir eğilim göstermiyorsa alarm üretilmez — yanlış
        alarm, hiç alarm olmamasından beterdir.
      </p>
    </section>
  );
}
