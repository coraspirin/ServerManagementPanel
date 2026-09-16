"use client";

import { useMemo, useState } from "react";
import { formatValue, type MetricFormat, type Series } from "@/lib/metrics/catalog";
import { useDict, useLocale, useT } from "@/lib/i18n/client";

/**
 * Bağımlılıksız zaman serisi grafiği (M1.1).
 *
 * Neden hazır grafik kütüphanesi yok: panel için gereken tek şey çizgi + bant;
 * recharts/chart.js bunun için 100 KB+ istemci paketi getirir ve tema
 * değişkenlerimizle uyumlanması ayrı iş olur.
 *
 * Ölçekleme hilesi: SVG sabit bir 1000×100 koordinat sisteminde çizilir ve
 * `preserveAspectRatio="none"` ile kutuya YAYILIR. Böylece kapsayıcı genişliğini
 * ölçmek (ResizeObserver) gerekmez. Çizgilerin yataydan ezilmesini
 * `vector-effect="non-scaling-stroke"` engeller; yazılar ise SVG içinde değil
 * HTML olarak konumlandırılır, çünkü onlar gerilirdi.
 */

const VB_W = 1000;
const VB_H = 100;

export const CHART_PALETTE = [
  "var(--brand)",
  "var(--ok)",
  "var(--warn)",
  "var(--danger)",
  "#a855f7",
  "#0891b2",
];

/** Eksen üst sınırını okunur bir sayıya yuvarlar (1, 2, 5 × 10ⁿ). */
function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function seriesTitle(series: Series, total: string): string {
  return series.label || total;
}

type Props = {
  series: Series[];
  format: MetricFormat;
  from: number;
  to: number;
  /** Yüzde metriklerinde 100 verilir; diğerlerinde eksen veriye uyar. */
  fixedMax?: number;
  /** Toplanmış katmanlarda min–max bandı çizilir; ham veride anlamsız. */
  showBand?: boolean;
  height?: number;
  /** Seri adları yerine gösterilecek etiketler (ör. iki metrikli ağ grafiği). */
  names?: string[];
};

export function MetricChart({
  series,
  format,
  from,
  to,
  fixedMax,
  showBand = true,
  height = 180,
  names,
}: Props) {
  const t = useT();
  const locale = useLocale();
  const dict = useDict();
  const [hoverX, setHoverX] = useState<number | null>(null);

  const model = useMemo(() => {
    const timestamps = [...new Set(series.flatMap((s) => s.points.map((p) => p.ts)))].sort(
      (a, b) => a - b,
    );

    let max = fixedMax ?? 0;
    if (fixedMax === undefined) {
      for (const s of series) {
        for (const p of s.points) max = Math.max(max, showBand ? p.max : p.avg);
      }
      max = niceCeil(max * 1.1);
    }

    const span = Math.max(1, to - from);
    const x = (ts: number) => ((ts - from) / span) * VB_W;
    const y = (value: number) => VB_H - (Math.min(value, max) / max) * VB_H;

    const paths = series.map((s) => {
      const line = s.points
        .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.ts).toFixed(2)} ${y(p.avg).toFixed(2)}`)
        .join(" ");

      // Bant: üst kenar boyunca ileri, alt kenar boyunca geri → kapalı alan.
      const upper = s.points
        .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.ts).toFixed(2)} ${y(p.max).toFixed(2)}`)
        .join(" ");
      const lower = [...s.points]
        .reverse()
        .map((p) => `L${x(p.ts).toFixed(2)} ${y(p.min).toFixed(2)}`)
        .join(" ");

      return { line, band: s.points.length > 1 ? `${upper} ${lower} Z` : "" };
    });

    const byTs = series.map((s) => new Map(s.points.map((p) => [p.ts, p])));

    return { timestamps, max, x, y, paths, byTs };
  }, [series, from, to, fixedMax, showBand]);

  const hasData = model.timestamps.length > 0;

  const hovered = useMemo(() => {
    if (hoverX === null || !hasData) return null;
    const targetTs = from + hoverX * (to - from);
    let best = model.timestamps[0];
    for (const ts of model.timestamps) {
      if (Math.abs(ts - targetTs) < Math.abs(best - targetTs)) best = ts;
    }
    return {
      ts: best,
      values: series.map((s, i) => ({
        name: names?.[i] ?? seriesTitle(s, t("metrics.legend.total")),
        color: CHART_PALETTE[i % CHART_PALETTE.length],
        point: model.byTs[i].get(best) ?? null,
      })),
    };
  }, [hoverX, hasData, from, to, model, series, names, t]);

  const ticks = [0, 0.25, 0.5, 0.75, 1];

  if (!hasData) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center rounded border border-dashed border-line text-xs text-subtle"
      >
        Bu aralık için henüz veri yok.
      </div>
    );
  }

  return (
    <div>
      <div className="relative" style={{ height }}>
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible"
          aria-hidden
        >
          {ticks.map((t) => (
            <line
              key={t}
              x1={0}
              x2={VB_W}
              y1={VB_H * t}
              y2={VB_H * t}
              stroke="var(--line)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {showBand &&
            model.paths.map(
              (path, i) =>
                path.band && (
                  <path
                    key={`band-${i}`}
                    d={path.band}
                    fill={CHART_PALETTE[i % CHART_PALETTE.length]}
                    opacity={0.14}
                  />
                ),
            )}

          {model.paths.map((path, i) => (
            <path
              key={`line-${i}`}
              d={path.line}
              fill="none"
              stroke={CHART_PALETTE[i % CHART_PALETTE.length]}
              strokeWidth={1.75}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {hovered && (
            <line
              x1={model.x(hovered.ts)}
              x2={model.x(hovered.ts)}
              y1={0}
              y2={VB_H}
              stroke="var(--subtle)"
              strokeWidth={1}
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {/* Y ekseni etiketleri — SVG içinde olsalar yatayda ezilirdi. */}
        {ticks.slice(0, 4).map((ratio) => (
          <span
            key={ratio}
            style={{ top: `${ratio * 100}%` }}
            className="pointer-events-none absolute left-1 -translate-y-1/2 bg-surface/80 px-0.5 text-[10px] text-subtle"
          >
            {formatValue(format, model.max * (1 - ratio), locale, dict)}
          </span>
        ))}

        <div
          className="absolute inset-0"
          onMouseMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            setHoverX((e.clientX - box.left) / box.width);
          }}
          onMouseLeave={() => setHoverX(null)}
        />

        {hovered && (
          <div
            style={{
              left: `${(model.x(hovered.ts) / VB_W) * 100}%`,
              transform:
                model.x(hovered.ts) > VB_W / 2
                  ? "translate(calc(-100% - 8px), 0)"
                  : "translate(8px, 0)",
            }}
            className="pointer-events-none absolute top-1 z-10 min-w-max rounded border border-line bg-surface px-2 py-1 text-[11px] shadow-sm"
          >
            <div className="text-subtle">
              {new Date(hovered.ts * 1000).toLocaleString("tr-TR", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
            {hovered.values.map((v) => (
              <div key={v.name} className="flex items-center gap-1.5">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: v.color }}
                />
                <span className="text-subtle">{v.name}</span>
                <span className="ml-auto font-medium">
                  {v.point ? formatValue(format, v.point.avg, locale, dict) : "—"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-1 flex justify-between text-[10px] text-subtle">
        {[0, 0.5, 1].map((t) => (
          <span key={t}>
            {new Date((from + (to - from) * t) * 1000).toLocaleString("tr-TR", {
              day: to - from > 86400 ? "2-digit" : undefined,
              month: to - from > 86400 ? "short" : undefined,
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Kartların içindeki küçük eğri — eksen ve etkileşim yok. */
export function Sparkline({
  points,
  color = "var(--brand)",
  fixedMax,
  height = 36,
}: {
  points: { ts: number; avg: number }[];
  color?: string;
  fixedMax?: number;
  height?: number;
}) {
  if (points.length < 2) return <div style={{ height }} />;

  const from = points[0].ts;
  const to = points[points.length - 1].ts;
  const span = Math.max(1, to - from);
  const max = fixedMax ?? niceCeil(Math.max(...points.map((p) => p.avg)) * 1.1);

  const coords = points.map((p) => ({
    x: ((p.ts - from) / span) * VB_W,
    y: VB_H - (Math.min(p.avg, max) / max) * VB_H,
  }));

  const line = coords
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${VB_W} ${VB_H} L0 ${VB_H} Z`;

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="none"
      style={{ height }}
      className="w-full"
      aria-hidden
    >
      <path d={area} fill={color} opacity={0.12} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
