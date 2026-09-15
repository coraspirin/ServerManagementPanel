"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, Cpu, HardDrive, MemoryStick, Network, Timer } from "lucide-react";
import { CHART_PALETTE, MetricChart } from "@/components/metrics/MetricChart";
import {
  CHART_METRICS,
  RANGES,
  formatBps,
  formatBytes,
  formatDuration,
  formatPct,
  metricMeta,
  rangeSeconds,
  type RangeId,
  type Series,
  type SeriesResult,
  type Snapshot,
} from "@/lib/metrics/catalog";

/** Grafikler kartlardan daha yavaş tazelenir; her biri yüzlerce nokta taşıyor. */
const CHART_REFRESH_MS = 30_000;

export type Thresholds = {
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
  defaultRange: RangeId;
  refreshSeconds: number;
  thresholds: Thresholds;
  cpuCount: number;
};

/** Eşikler ayarlardan gelir (İlkeler #5) — burada sabit sayı yok. */
function levelClass(value: number | null, warn: number, crit: number): string {
  if (value === null) return "text-subtle";
  if (value >= crit) return "text-danger";
  if (value >= warn) return "text-warn";
  return "text-ink";
}

function barClass(value: number, warn: number, crit: number): string {
  if (value >= crit) return "bg-danger";
  if (value >= warn) return "bg-warn";
  return "bg-brand";
}

function legendNames(series: Series[]): string[] {
  const singleMetric = new Set(series.map((s) => s.metric)).size === 1;
  return series.map((s) => {
    const label = metricMeta(s.metric).label;
    if (singleMetric) return s.label || label;
    return s.label ? `${label} · ${s.label}` : label;
  });
}

export function MonitoringScreen({
  initialSnapshot,
  initialSeries,
  defaultRange,
  refreshSeconds,
  thresholds,
  cpuCount,
}: Props) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [range, setRange] = useState<RangeId>(defaultRange);
  const [data, setData] = useState<SeriesResult>(initialSeries);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  // Kartlar: ayarlardaki arayüz yenileme aralığında.
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/metrics/system", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) return;
        const body = (await response.json()) as { snapshot: Snapshot };
        setSnapshot(body.snapshot);
        setNow(Math.floor(Date.now() / 1000));
      } catch {
        // Ağ hatası: bir sonraki turda yeniden denenir, ekran son değeri tutar.
      }
    };

    const timer = setInterval(load, Math.max(2, refreshSeconds) * 1000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [refreshSeconds]);

  const loadCharts = useCallback(async (target: RangeId, signal?: AbortSignal) => {
    try {
      const response = await fetch(
        `/api/metrics/series?range=${target}&metrics=${CHART_METRICS.join(",")}`,
        { signal, cache: "no-store" },
      );
      if (response.ok) setData((await response.json()) as SeriesResult);
    } catch {
      // Ağ hatası: mevcut grafik ekranda kalır, bir sonraki turda yeniden denenir.
    }
  }, []);

  // Aralık değişince hemen çek, sonrasında düzenli aralıklarla tazele.
  //
  // İlk çekim `setTimeout(…, 0)` ile bir sonraki göreve bırakılıyor: effect
  // gövdesinden doğrudan çağrılırsa React'in "effect içinde eşzamanlı setState"
  // kuralı devreye giriyor. Veri zaten ağdan geldiği için gerçekte zincirleme
  // render yok, ama kuralı susturmak yerine çağrıyı doğru yere taşımak yeğdir.
  useEffect(() => {
    const controller = new AbortController();
    const immediate = setTimeout(() => void loadCharts(range, controller.signal), 0);
    const timer = setInterval(
      () => void loadCharts(range, controller.signal),
      CHART_REFRESH_MS,
    );

    return () => {
      controller.abort();
      clearTimeout(immediate);
      clearInterval(timer);
    };
  }, [range, loadCharts]);

  // "Yükleniyor" ayrı bir state değil, türetiliyor: elimizdeki verinin kapsadığı
  // aralık seçili aralıkla uyuşmuyorsa henüz yeni veri gelmemiştir.
  const chartsStale = Math.abs(data.to - data.from - rangeSeconds(range)) > 5;

  const pick = (metrics: string[]): Series[] =>
    metrics.flatMap((metric) => data.series.filter((s) => s.metric === metric));

  const showBand = data.tier !== "ham";
  const worstDisk = snapshot.disks.reduce<Snapshot["disks"][number] | null>(
    (worst, disk) => (worst === null || disk.usedPct > worst.usedPct ? disk : worst),
    null,
  );
  const totalRx = snapshot.interfaces.reduce((sum, i) => sum + i.rxBps, 0);
  const totalTx = snapshot.interfaces.reduce((sum, i) => sum + i.txBps, 0);
  const age = snapshot.ts === null ? null : Math.max(0, now - snapshot.ts);

  return (
    <div className="space-y-6">
      {snapshot.ts === null && (
        <p className="rounded-lg border border-dashed border-line bg-surface px-5 py-4 text-sm text-subtle">
          Henüz metrik toplanmadı. Toplama işi ayarlardaki aralıkta çalışır; birkaç
          saniye içinde kartlar dolacak.
        </p>
      )}

      {/* Telefonda da iki sütun: kartlar zaten kısa, tek sütun altı ekranlık
          bir kaydırma listesi çıkarıyordu. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Card
          icon={<Cpu className="size-4" />}
          title="İşlemci"
          value={snapshot.cpuPct === null ? "—" : formatPct(snapshot.cpuPct)}
          valueClass={levelClass(snapshot.cpuPct, thresholds.cpuWarn, thresholds.cpuCrit)}
          note={
            snapshot.cpuIowaitPct === null
              ? `${cpuCount} çekirdek`
              : `${cpuCount} çekirdek · G/Ç bekleme ${formatPct(snapshot.cpuIowaitPct)}`
          }
        />
        <Card
          icon={<MemoryStick className="size-4" />}
          title="Bellek"
          value={snapshot.memUsedPct === null ? "—" : formatPct(snapshot.memUsedPct)}
          valueClass={levelClass(snapshot.memUsedPct, thresholds.ramWarn, thresholds.ramCrit)}
          note={
            snapshot.memUsed !== null && snapshot.memTotal !== null
              ? `${formatBytes(snapshot.memUsed)} / ${formatBytes(snapshot.memTotal)}`
              : "—"
          }
        />
        <Card
          icon={<HardDrive className="size-4" />}
          title="Disk"
          value={worstDisk ? formatPct(worstDisk.usedPct) : "—"}
          valueClass={levelClass(
            worstDisk?.usedPct ?? null,
            thresholds.diskWarn,
            thresholds.diskCrit,
          )}
          note={worstDisk ? `${worstDisk.mount} · ${formatBytes(worstDisk.free)} boş` : "—"}
        />
        <Card
          icon={<Network className="size-4" />}
          title="Ağ"
          value={snapshot.interfaces.length > 0 ? formatBps(totalRx) : "—"}
          note={
            snapshot.interfaces.length > 0
              ? `↓ indirme · ↑ ${formatBps(totalTx)} yükleme`
              : "arayüz bulunamadı"
          }
        />
        <Card
          icon={<Activity className="size-4" />}
          title="Sistem yükü"
          value={snapshot.load1 === null ? "—" : snapshot.load1.toFixed(2)}
          valueClass={levelClass(
            snapshot.load1 === null ? null : (snapshot.load1 / cpuCount) * 100,
            100,
            150,
          )}
          note={
            snapshot.load5 === null
              ? "—"
              : `5 dk ${snapshot.load5.toFixed(2)} · 15 dk ${snapshot.load15?.toFixed(2) ?? "—"}`
          }
        />
        <Card
          icon={<Timer className="size-4" />}
          title="Çalışma süresi"
          value={
            snapshot.uptimeSeconds === null ? "—" : formatDuration(snapshot.uptimeSeconds)
          }
          note={age === null ? "—" : `son örnek ${age} sn önce`}
        />
      </div>

      {snapshot.disks.length > 0 && (
        <section className="rounded-lg border border-line bg-surface p-5">
          <h2 className="font-semibold">Disk bölümleri</h2>
          <div className="mt-4 space-y-3">
            {snapshot.disks.map((disk) => (
              <div key={disk.mount}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate font-mono text-xs">{disk.mount}</span>
                  <span className="shrink-0 text-xs text-subtle">
                    {formatBytes(disk.used)} / {formatBytes(disk.total)} ·{" "}
                    <span
                      className={levelClass(
                        disk.usedPct,
                        thresholds.diskWarn,
                        thresholds.diskCrit,
                      )}
                    >
                      {formatPct(disk.usedPct)}
                    </span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
                  <div
                    className={`h-full rounded-full ${barClass(disk.usedPct, thresholds.diskWarn, thresholds.diskCrit)}`}
                    style={{ width: `${Math.min(100, disk.usedPct)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {RANGES.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setRange(option.id)}
              className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                range === option.id
                  ? "border-brand bg-brand/10 text-brand"
                  : "border-line text-subtle hover:text-ink"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-subtle">
          {chartsStale ? "yükleniyor…" : `çözünürlük: ${data.tier}`}
        </span>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="İşlemci"
          series={pick(["cpu.pct", "cpu.iowait_pct"])}
          format="pct"
          fixedMax={100}
          showBand={showBand}
          from={data.from}
          to={data.to}
        />
        <ChartCard
          title="Bellek ve takas"
          series={pick(["mem.used_pct", "swap.used_pct"])}
          format="pct"
          fixedMax={100}
          showBand={showBand}
          from={data.from}
          to={data.to}
        />
        <ChartCard
          title="Ağ trafiği"
          series={pick(["net.rx_bps", "net.tx_bps"])}
          format="bps"
          showBand={showBand}
          from={data.from}
          to={data.to}
        />
        <ChartCard
          title="Disk doluluğu"
          series={pick(["disk.used_pct"])}
          format="pct"
          fixedMax={100}
          showBand={showBand}
          from={data.from}
          to={data.to}
        />
        <ChartCard
          title="Sistem yükü"
          series={pick(["load.1m", "load.5m", "load.15m"])}
          format="number"
          showBand={showBand}
          from={data.from}
          to={data.to}
        />
      </div>
    </div>
  );
}

function Card({
  icon,
  title,
  value,
  note,
  valueClass = "text-ink",
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  note: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center gap-1.5 text-xs text-subtle">
        {icon}
        {title}
      </div>
      <div className={`mt-1 truncate text-2xl font-semibold ${valueClass}`} title={value}>
        {value}
      </div>
      <div className="mt-0.5 truncate text-xs text-subtle" title={note}>
        {note}
      </div>
    </div>
  );
}

function ChartCard({
  title,
  series,
  format,
  fixedMax,
  showBand,
  from,
  to,
}: {
  title: string;
  series: Series[];
  format: React.ComponentProps<typeof MetricChart>["format"];
  fixedMax?: number;
  showBand: boolean;
  from: number;
  to: number;
}) {
  const names = legendNames(series);

  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        <div className="flex flex-wrap gap-3">
          {names.map((name, i) => (
            <span key={name} className="flex items-center gap-1.5 text-xs text-subtle">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: CHART_PALETTE[i % CHART_PALETTE.length] }}
              />
              {name}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-4">
        <MetricChart
          series={series}
          names={names}
          format={format}
          fixedMax={fixedMax}
          showBand={showBand}
          from={from}
          to={to}
        />
      </div>
    </section>
  );
}
