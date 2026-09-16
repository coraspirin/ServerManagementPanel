/**
 * Metrik meta verisi, paylaşılan tipler ve biçimlendirme.
 *
 * Bu dosyada `server-only` YOK: hem job runner hem de İzleme ekranı (istemci)
 * aynı tanımları kullanır. Veritabanına dokunan kod query.ts / collect.ts
 * içindedir ve tiplerini buradan alır.
 */

import { formatDuration, formatPct } from "@/lib/i18n/format";
import { translateLoose } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import type { Dictionary } from "@/lib/i18n/dict/tr";

export type SeriesPoint = { ts: number; avg: number; min: number; max: number };
export type Series = { metric: string; label: string; points: SeriesPoint[] };

export type SeriesResult = {
  /** Katman ANAHTARI ("raw" | "minute" | "hour" | "day") — adı sözlükten. */
  tier: string;
  resolution: number;
  from: number;
  to: number;
  series: Series[];
};

export type DiskSnapshot = {
  mount: string;
  usedPct: number;
  used: number;
  free: number;
  total: number;
};

export type InterfaceSnapshot = { name: string; rxBps: number; txBps: number };

/** Kartları besleyen son değerler. Hiç örnek yoksa alanlar null gelir. */
export type Snapshot = {
  ts: number | null;
  cpuPct: number | null;
  cpuIowaitPct: number | null;
  memUsedPct: number | null;
  memUsed: number | null;
  memTotal: number | null;
  swapUsedPct: number | null;
  swapUsed: number | null;
  load1: number | null;
  load5: number | null;
  load15: number | null;
  uptimeSeconds: number | null;
  disks: DiskSnapshot[];
  interfaces: InterfaceSnapshot[];
};

export type RangeId = "1h" | "6h" | "24h" | "7d" | "30d" | "1y";

export const RANGES: { id: RangeId; seconds: number }[] = [
  { id: "1h", seconds: 3600 },
  { id: "6h", seconds: 6 * 3600 },
  { id: "24h", seconds: 86400 },
  { id: "7d", seconds: 7 * 86400 },
  { id: "30d", seconds: 30 * 86400 },
  { id: "1y", seconds: 365 * 86400 },
];

export function rangeSeconds(id: string): number {
  return RANGES.find((r) => r.id === id)?.seconds ?? 86400;
}

export function isRangeId(value: string): value is RangeId {
  return RANGES.some((r) => r.id === value);
}

/**
 * İzleme ekranındaki grafiklerin metrikleri.
 *
 * Sunucu ilk yüklemede, istemci de tazelerken aynı listeyi kullanır; iki yerde
 * ayrı ayrı yazılırsa biri unutulup grafiklerden biri boş kalır.
 */
export const CHART_METRICS = [
  "cpu.pct",
  "cpu.iowait_pct",
  "mem.used_pct",
  "swap.used_pct",
  "net.rx_bps",
  "net.tx_bps",
  "disk.used_pct",
  "load.1m",
  "load.5m",
  "load.15m",
];

// --- Biçimlendirme ---------------------------------------------------------

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes)) return "—";
  let value = Math.abs(bytes);
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const sign = bytes < 0 ? "-" : "";
  return `${sign}${value.toFixed(unit === 0 ? 0 : digits)} ${BYTE_UNITS[unit]}`;
}

/**
 * Ağ hızı. Sayaçlar BAYT/sn tutuyor; kullanıcıya bit/sn gösteriyoruz çünkü
 * internet hızları (100 Mbps vb.) o birimde konuşulur.
 */
export function formatBps(bytesPerSecond: number): string {
  const bits = Math.max(0, bytesPerSecond) * 8;
  const units = ["bps", "Kbps", "Mbps", "Gbps"];
  let value = bits;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/*
  Yüzde ve süre biçimleme BURADA DEĞİL, `lib/i18n/format.ts` içinde: ikisi de
  dile bağlı (Türkçe "%42.5" ve "2 gün 3 saat", İngilizce "42.5%" ve
  "2 days 3 hours"). Bayt ve bit/sn ise dilden bağımsız olduğu için burada
  kaldı.
*/

// --- Metrik tanımları ------------------------------------------------------

export type MetricFormat = "pct" | "bytes" | "bps" | "number" | "duration" | "ms";

export type MetricMeta = {
  format: MetricFormat;
  /** Yüzde metriklerinde y ekseni 0–100 sabitlenir; diğerlerinde veriye uyar. */
  fixedMax?: number;
  /** Etiket (mount/arayüz) taşıyan metrikler grafikte seri başına ayrışır. */
  labelled?: boolean;
};

export const METRIC_META: Record<string, MetricMeta> = {
  "cpu.pct": { format: "pct", fixedMax: 100 },
  "cpu.iowait_pct": { format: "pct", fixedMax: 100 },
  "mem.used_pct": { format: "pct", fixedMax: 100 },
  "mem.used": { format: "bytes" },
  "mem.total": { format: "bytes" },
  "swap.used_pct": { format: "pct", fixedMax: 100 },
  "swap.used": { format: "bytes" },
  "load.1m": { format: "number" },
  "load.5m": { format: "number" },
  "load.15m": { format: "number" },
  "uptime.seconds": { format: "duration" },
  "disk.used_pct": { format: "pct", fixedMax: 100, labelled: true },
  "disk.used": { format: "bytes", labelled: true },
  "disk.free": { format: "bytes", labelled: true },
  "disk.total": { format: "bytes", labelled: true },
  "net.rx_bps": { format: "bps", labelled: true },
  "net.tx_bps": { format: "bps", labelled: true },
  // M1.2 — health-check gecikmesi. Ayrı bir zaman serisi tablosu açmak yerine
  // T1 hattına giriyor: rollup, budama ve grafik hazır geliyor. `label` =
  // monitör kimliği.
  "monitor.latency": { format: "ms", labelled: true },
  // M1.6 — container ölçümleri. `label` = container adı.
  "docker.cpu_pct": { format: "pct", labelled: true },
  "docker.mem_used": { format: "bytes", labelled: true },
  "docker.mem_pct": { format: "pct", fixedMax: 100, labelled: true },
  // Kümülatif sayaçlar (M3.22) — grafikte hıza çevrilerek gösteriliyor.
  "docker.net_rx": { format: "bytes", labelled: true },
  "docker.net_tx": { format: "bytes", labelled: true },
  "docker.blk_read": { format: "bytes", labelled: true },
  "docker.blk_write": { format: "bytes", labelled: true },
  "docker.restart_count": { format: "number", labelled: true },
  "docker.running": { format: "number", fixedMax: 1, labelled: true },
};

export function metricMeta(metric: string): MetricMeta {
  return METRIC_META[metric] ?? { format: "number" };
}

/**
 * Metriğin ekranda görünen adı. Sözlükte karşılığı yoksa metriğin kimliği
 * gösterilir — grafiğin göstergesini boş bırakmaktansa "cpu.pct" yazsın.
 */
export function metricLabel(dict: Dictionary, metric: string): string {
  const labels = dict.metrics.labels as Record<string, string>;
  return labels[metric] ?? metric;
}

/** Aralık düğmesinin metni ("24 saat" / "24 hours"). */
export function rangeLabel(dict: Dictionary, id: RangeId): string {
  const ranges = dict.metrics.ranges as Record<string, string>;
  return ranges[id] ?? id;
}

/** Çözünürlük katmanının adı; `SeriesResult.tier` bir ANAHTAR taşıyor. */
export function tierLabel(dict: Dictionary, tier: string): string {
  const tiers = dict.metrics.tiers as Record<string, string>;
  return tiers[tier] ?? tier;
}

export function formatValue(
  format: MetricFormat,
  value: number,
  locale: Locale,
  dict: Dictionary,
): string {
  switch (format) {
    case "pct":
      return formatPct(value, locale);
    case "bytes":
      return formatBytes(value);
    case "bps":
      return formatBps(value);
    case "duration":
      return formatDuration(value, locale, dict);
    case "ms":
      return value >= 1000
        ? translateLoose(dict, locale, "metrics.value.seconds", { value: (value / 1000).toFixed(2) })
        : translateLoose(dict, locale, "metrics.value.milliseconds", { value: Math.round(value) });
    default:
      return value.toFixed(2);
  }
}
