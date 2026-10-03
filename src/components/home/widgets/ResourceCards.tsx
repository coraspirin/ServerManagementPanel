"use client";

import Link from "next/link";
import { useEffect, useState, type ComponentType } from "react";
import { Cpu, HardDrive, MemoryStick, Network } from "lucide-react";
import {
  formatBps,
  formatBytes,
  type SeriesPoint,
  type SeriesResult,
  type Snapshot,
} from "@/lib/metrics/catalog";
import { RESOURCE_METRICS } from "@/lib/dashboard/catalog";
import { useFormat, useT } from "@/lib/i18n/client";
import { TONE_BG, TONE_TEXT, toneFor } from "./WidgetCard";

/**
 * Kaynak kartları — CPU, bellek, en dolu disk ve ağ; her biri son bir saatin
 * küçük grafiğiyle.
 *
 * İlk değerler sunucudan geliyor (sayfa dolu açılsın); istemci anlık değeri
 * arayüz yenileme aralığında, grafiği dakikada bir tazeliyor. Ayrıntılı
 * grafikler İzleme ekranında — bu kartların işi yön göstermek.
 */

const SERIES_REFRESH_MS = 60_000;

type Thresholds = {
  cpuWarn: number;
  cpuCrit: number;
  ramWarn: number;
  ramCrit: number;
  diskWarn: number;
  diskCrit: number;
};

type Props = {
  initialSnapshot: Snapshot;
  initialSeries: SeriesResult;
  refreshSeconds: number;
  thresholds: Thresholds;
  /** En dolu diskin dolmasına kalan gün (tahmin yoksa null), bağlama noktasına göre. */
  diskForecast: Record<string, number | null>;
  /**
   * false (kiosk): API yoklanmaz — uçlar oturum istiyor ve kiosk sayfası
   * kendini zaten periyodik olarak yeniliyor. Kartlar bağlantı da olmaz.
   */
  live?: boolean;
};

/** Birden çok etiketin (arayüz) aynı andaki değerlerini toplar. */
function sumByTs(series: SeriesResult["series"], metric: string): SeriesPoint[] {
  const totals = new Map<number, number>();
  for (const s of series) {
    if (s.metric !== metric) continue;
    for (const point of s.points) totals.set(point.ts, (totals.get(point.ts) ?? 0) + point.avg);
  }
  return [...totals.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, avg]) => ({ ts, avg, min: avg, max: avg }));
}

function pick(series: SeriesResult["series"], metric: string, label = ""): SeriesPoint[] {
  return series.find((s) => s.metric === metric && s.label === label)?.points ?? [];
}

export function ResourceCards({
  initialSnapshot,
  initialSeries,
  refreshSeconds,
  thresholds,
  diskForecast,
  live = true,
}: Props) {
  const t = useT();
  const f = useFormat();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [data, setData] = useState(initialSeries);

  useEffect(() => {
    if (!live) return;
    const controller = new AbortController();
    const loadSnapshot = async () => {
      try {
        const response = await fetch("/api/metrics/system", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (response.ok) setSnapshot(((await response.json()) as { snapshot: Snapshot }).snapshot);
      } catch {
        // Ağ hatası: kart son değeri tutar, bir sonraki turda yeniden denenir.
      }
    };
    const loadSeries = async () => {
      try {
        const response = await fetch(
          `/api/metrics/series?range=1h&metrics=${RESOURCE_METRICS.join(",")}`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (response.ok) setData((await response.json()) as SeriesResult);
      } catch {
        // Aynı gerekçe.
      }
    };

    const snapshotTimer = setInterval(loadSnapshot, Math.max(2, refreshSeconds) * 1000);
    const seriesTimer = setInterval(loadSeries, SERIES_REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(snapshotTimer);
      clearInterval(seriesTimer);
    };
  }, [refreshSeconds, live]);

  const worstDisk = snapshot.disks.reduce<Snapshot["disks"][number] | null>(
    (worst, disk) => (worst === null || disk.usedPct > worst.usedPct ? disk : worst),
    null,
  );
  const rx = snapshot.interfaces.reduce((sum, i) => sum + i.rxBps, 0);
  const tx = snapshot.interfaces.reduce((sum, i) => sum + i.txBps, 0);
  const daysToFull = worstDisk ? diskForecast[worstDisk.mount] ?? null : null;

  const pctValue = (value: number | null) => (value === null ? "—" : f.pct(value, 0));

  if (snapshot.ts === null) {
    return (
      <p className="rounded-lg border border-dashed border-line bg-surface px-5 py-4 text-sm text-subtle">
        {t("dashboard.resources.noData")}
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      <Tile
        link={live}
        icon={Cpu}
        title={t("dashboard.resources.cpu")}
        value={pctValue(snapshot.cpuPct)}
        tone={toneFor(snapshot.cpuPct, thresholds.cpuWarn, thresholds.cpuCrit)}
        detail={
          snapshot.load1 === null
            ? ""
            : t("dashboard.resources.load", { value: f.number(snapshot.load1, { maximumFractionDigits: 2 }) })
        }
        points={pick(data.series, "cpu.pct")}
        max={100}
        format={(v) => f.pct(v, 0)}
      />
      <Tile
        link={live}
        icon={MemoryStick}
        title={t("dashboard.resources.memory")}
        value={pctValue(snapshot.memUsedPct)}
        tone={toneFor(snapshot.memUsedPct, thresholds.ramWarn, thresholds.ramCrit)}
        detail={
          snapshot.memUsed !== null && snapshot.memTotal !== null
            ? `${formatBytes(snapshot.memUsed)} / ${formatBytes(snapshot.memTotal)}`
            : ""
        }
        points={pick(data.series, "mem.used_pct")}
        max={100}
        format={(v) => f.pct(v, 0)}
      />
      <Tile
        link={live}
        icon={HardDrive}
        title={worstDisk ? t("dashboard.resources.diskAt", { mount: worstDisk.mount }) : t("dashboard.resources.disk")}
        value={pctValue(worstDisk?.usedPct ?? null)}
        tone={toneFor(worstDisk?.usedPct ?? null, thresholds.diskWarn, thresholds.diskCrit)}
        detail={
          worstDisk
            ? daysToFull !== null && daysToFull < 365
              ? t("dashboard.resources.diskFull", {
                  free: formatBytes(worstDisk.free),
                  days: Math.max(0, Math.round(daysToFull)),
                })
              : t("dashboard.resources.diskFree", { free: formatBytes(worstDisk.free) })
            : ""
        }
        points={worstDisk ? pick(data.series, "disk.used_pct", worstDisk.mount) : []}
        max={100}
        format={(v) => f.pct(v, 1)}
      />
      <Tile
        link={live}
        icon={Network}
        title={t("dashboard.resources.network")}
        value={`↓ ${formatBps(rx)}`}
        tone="ok"
        neutral
        detail={`↑ ${formatBps(tx)}`}
        points={sumByTs(data.series, "net.rx_bps")}
        format={(v) => formatBps(v)}
      />
    </div>
  );
}

function Tile({
  link,
  icon: Icon,
  title,
  value,
  tone,
  neutral = false,
  detail,
  points,
  max,
  format,
}: {
  link: boolean;
  icon: ComponentType<{ className?: string }>;
  title: string;
  value: string;
  tone: "ok" | "warn" | "danger";
  /** Eşiği olmayan ölçü (ağ): değer renklenmez. */
  neutral?: boolean;
  detail: string;
  points: SeriesPoint[];
  max?: number;
  format: (value: number) => string;
}) {
  const t = useT();
  const Root = link ? Link : "div";
  return (
    <Root
      href="/monitoring"
      className={`group flex min-w-0 flex-col rounded-lg border border-line bg-surface p-4 ${
        link ? "transition-colors hover:border-brand/50" : ""
      }`}
    >
      <div className="flex items-center gap-2 text-xs text-subtle">
        <Icon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {!neutral && tone !== "ok" && (
          // Renk tek başına durum bildirmesin: eşik aşıldıysa metin de var.
          <span className={`flex items-center gap-1 font-medium ${TONE_TEXT[tone]}`}>
            <span className={`size-1.5 rounded-full ${TONE_BG[tone]}`} aria-hidden />
            {t(tone === "danger" ? "dashboard.resources.critical" : "dashboard.resources.high")}
          </span>
        )}
      </div>
      <div
        className={`mt-1 truncate text-xl font-semibold tabular-nums sm:text-2xl ${neutral || tone === "ok" ? "text-ink" : TONE_TEXT[tone]}`}
      >
        {value}
      </div>
      <div className="truncate text-xs text-subtle" title={detail}>
        {detail || " "}
      </div>
      <Sparkline points={points} max={max} format={format} />
    </Root>
  );
}

const W = 200;
const H = 40;
/** Kart genişliğinde 720 ham nokta okunmaz, gürültü olarak görünür. */
const BUCKETS = 60;

/** Eşit zaman dilimlerinin ortalaması — çizginin yönü korunur, titreşim gider. */
function downsample(points: SeriesPoint[]): SeriesPoint[] {
  if (points.length <= BUCKETS) return points;
  const from = points[0].ts;
  const span = Math.max(1, points[points.length - 1].ts - from);
  const sums = new Map<number, { ts: number; total: number; count: number }>();
  for (const point of points) {
    const index = Math.min(BUCKETS - 1, Math.floor(((point.ts - from) / span) * BUCKETS));
    const bucket = sums.get(index) ?? { ts: point.ts, total: 0, count: 0 };
    bucket.total += point.avg;
    bucket.count += 1;
    bucket.ts = point.ts;
    sums.set(index, bucket);
  }
  return [...sums.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, b]) => {
      const avg = b.total / b.count;
      return { ts: b.ts, avg, min: avg, max: avg };
    });
}
/**
 * Tek serili küçük çizgi grafik. Ekseni yok — kesin değer kartın üstünde;
 * bu çizginin işi yalnızca yönü göstermek. Üzerine gelince o anın değeri
 * ve saati okunuyor.
 */
function Sparkline({
  points: raw,
  max,
  format,
}: {
  points: SeriesPoint[];
  max?: number;
  format: (value: number) => string;
}) {
  const f = useFormat();
  const [hover, setHover] = useState<number | null>(null);
  const points = downsample(raw);

  if (points.length < 2) return <div className="mt-3 h-10" aria-hidden />;

  const from = points[0].ts;
  const span = Math.max(1, points[points.length - 1].ts - from);
  const top = max ?? Math.max(...points.map((p) => p.avg), 1);
  const x = (ts: number) => ((ts - from) / span) * W;
  const y = (value: number) => H - 2 - (Math.min(value, top) / top) * (H - 4);
  const line = points.map((p) => `${x(p.ts).toFixed(1)},${y(p.avg).toFixed(1)}`).join(" ");
  const active = hover === null ? null : points[hover];

  return (
    <div className="relative mt-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-10 w-full overflow-visible"
        aria-hidden
        onMouseLeave={() => setHover(null)}
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientX - box.left) / Math.max(1, box.width);
          const target = from + ratio * span;
          let best = 0;
          for (let i = 1; i < points.length; i++) {
            if (Math.abs(points[i].ts - target) < Math.abs(points[best].ts - target)) best = i;
          }
          setHover(best);
        }}
      >
        <polygon points={`0,${H} ${line} ${W},${H}`} className="fill-brand/10" />
        <polyline
          points={line}
          fill="none"
          vectorEffect="non-scaling-stroke"
          strokeWidth={2}
          strokeLinejoin="round"
          className="stroke-brand"
        />
        {active && (
          <line
            x1={x(active.ts)}
            x2={x(active.ts)}
            y1={0}
            y2={H}
            vectorEffect="non-scaling-stroke"
            strokeWidth={1}
            className="stroke-subtle"
          />
        )}
      </svg>
      {active && (
        <span className="pointer-events-none absolute -top-5 right-0 rounded border border-line bg-surface px-1.5 py-0.5 text-[11px] tabular-nums shadow-sm">
          {f.time(active.ts * 1000, { hour: "2-digit", minute: "2-digit" })} · {format(active.avg)}
        </span>
      )}
    </div>
  );
}
