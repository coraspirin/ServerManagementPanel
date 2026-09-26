import "server-only";
import { formatPct } from "@/lib/i18n/format";
import { currentDictionary, serverT } from "@/lib/i18n/runtime";

import { getDb } from "@/lib/db/client";
import { fold } from "@/lib/text";
import { getNumber } from "@/lib/settings";
import type { Severity } from "@/lib/alerts/types";
import { currentHostId } from "@/lib/hosts/context";

/**
 * M3.2 — değişiklik zaman çizelgesi.
 *
 * Üç ayrı kaynak tek şeritte birleşir:
 *   audit_log → kim neyi değiştirdi
 *   events    → ne oldu (alarm/çözülme)
 *   metrikler → ani sıçramalar
 *
 * YENİ TABLO YOK. Bu bilinçli: üçünü kopyalayan dördüncü bir tablo, üç ayrı
 * yazma yolunun da onu beslemesini gerektirirdi ve biri unutulduğunda çizelge
 * sessizce eksik olurdu. Birleşik SORGU her zaman kaynağın kendisini okur.
 *
 * Çizelgenin amacı nedensellik kurmak: "22:00'de şu ayar değişti → 22:05'te şu
 * container çöktü". Bu yüzden sıralama katı zaman sırasıdır ve kaynak türü
 * yalnızca renk/simge farkıdır.
 */

export type TimelineKind = "audit" | "event" | "spike";

export type TimelineEntry = {
  /** Kaynak + kimlik: aynı saniyede birden çok kayıt olabildiği için gerekli. */
  id: string;
  ts: number;
  kind: TimelineKind;
  severity: Severity;
  title: string;
  detail: string;
  /** Değişikliği yapan kişi (audit) — diğer kaynaklarda boş. */
  actor: string;
  /** Metrik adı, olay kaynağı ya da audit işlemi. */
  source: string;
};

export type TimelineFilter = {
  /** Verilmezse son 24 saat. Saati burada okumak, sunucu bileşenlerinin
   *  render sırasında Date.now() çağırmasını gereksiz kılıyor. */
  since?: number;
  until?: number;
  kinds?: TimelineKind[];
  q?: string;
  limit?: number;
};

const DEFAULT_WINDOW_SECONDS = 24 * 3600;

export type TimelineResult = {
  entries: TimelineEntry[];
  since: number;
  until: number;
  /** Kaynak başına toplam — filtre kapalıyken bile "orada ne var" görünsün. */
  counts: Record<TimelineKind, number>;
  truncated: boolean;
};

const MAX_ENTRIES = 500;

/**
 * Sıçrama aranan metrikler. Liste kapalı tutuluyor: her metrik anlamlı bir
 * "sıçrama" tanımına sahip değil (uptime.seconds sürekli artar, disk.total hiç
 * değişmez). Eşikler ayarlardan gelir (PLAN İlkeler #5).
 */
type SpikeRule = {
  metric: string;
  /** Eşik hangi ayardan okunacak. */
  setting: "alerts.timeline_jump_pct" | "alerts.timeline_net_jump_mbps";
  label: (label: string) => string;
  /** Ham değeri okunur metne çevirir. */
  format: (value: number) => string;
  /** Ayardaki birim ham değere çevrilirken kullanılır (net: Mbit → bit). */
  scale?: number;
};

const SPIKE_RULES: SpikeRule[] = [
  {
    metric: "cpu.pct",
    setting: "alerts.timeline_jump_pct",
    label: () => "CPU",
    format: (value) => formatPct(value, currentDictionary(), 0),
  },
  {
    metric: "mem.used_pct",
    setting: "alerts.timeline_jump_pct",
    label: () => serverT("timelineLib.memory"),
    format: (value) => formatPct(value, currentDictionary(), 0),
  },
  {
    metric: "disk.used_pct",
    setting: "alerts.timeline_jump_pct",
    label: (label) => `Disk ${label}`,
    format: (value) => formatPct(value, currentDictionary(), 1),
  },
  {
    metric: "swap.used_pct",
    setting: "alerts.timeline_jump_pct",
    label: () => serverT("timelineLib.swap"),
    format: (value) => formatPct(value, currentDictionary(), 0),
  },
  {
    metric: "docker.cpu_pct",
    setting: "alerts.timeline_jump_pct",
    label: (label) => `${label} CPU`,
    format: (value) => formatPct(value, currentDictionary(), 0),
  },
  {
    metric: "docker.mem_pct",
    setting: "alerts.timeline_jump_pct",
    label: (label) => serverT("timelineLib.containerMemory", { name: label }),
    format: (value) => formatPct(value, currentDictionary(), 0),
  },
  {
    metric: "net.rx_bps",
    setting: "alerts.timeline_net_jump_mbps",
    label: (label) => serverT("timelineLib.download", { name: label }),
    format: (value) => serverT("timelineLib.mbps", { value: (value / 1_000_000).toFixed(1) }),
    scale: 1_000_000,
  },
  {
    metric: "net.tx_bps",
    setting: "alerts.timeline_net_jump_mbps",
    label: (label) => serverT("timelineLib.upload", { name: label }),
    format: (value) => serverT("timelineLib.mbps", { value: (value / 1_000_000).toFixed(1) }),
    scale: 1_000_000,
  },
];

type SpikeRow = {
  metric: string;
  label: string;
  ts: number;
  avg_value: number;
  previous: number;
};

/**
 * Sıçrama = bir 1 dakikalık kovanın ortalamasının bir öncekinden eşik kadar
 * yukarı atlaması. Mutlak seviye değil DEĞİŞİM aranıyor: sürekli %85'te duran
 * bir disk zaten alarm konusu (M1.3), çizelgede aranan şey "tam o anda ne
 * oldu" sorusunun cevabı.
 *
 * Düşüşler kaydedilmiyor. Yükün geri çekilmesi bir olay değil, olayın bitişi;
 * çizelgeye konsaydı her sıçrama iki satır üretirdi.
 */
function findSpikes(since: number, until: number): TimelineEntry[] {
  const db = getDb();
  const entries: TimelineEntry[] = [];

  for (const rule of SPIKE_RULES) {
    const threshold = getNumber(rule.setting) * (rule.scale ?? 1);
    if (threshold <= 0) continue;

    const rows = db
      .prepare(
        `SELECT metric, label, ts, avg_value, previous FROM (
           SELECT metric, label, ts, avg_value,
                  LAG(avg_value) OVER (PARTITION BY metric, label ORDER BY ts) AS previous
           FROM metrics_1m
           WHERE host_id = ? AND metric = ? AND ts >= ? AND ts <= ?
         )
         WHERE previous IS NOT NULL AND avg_value - previous >= ?
         ORDER BY ts`,
      )
      // Bir önceki kovayı da görebilmek için pencere bir dakika geriden başlıyor;
      // aksi halde aralığın ilk kovası hiçbir zaman sıçrama sayılmazdı.
      .all(currentHostId(), rule.metric, since - 60, until, threshold) as unknown as SpikeRow[];

    for (const row of rows) {
      const jump = Number(row.avg_value) - Number(row.previous);
      entries.push({
        id: `spike:${row.metric}:${row.label}:${row.ts}`,
        ts: Number(row.ts),
        kind: "spike",
        severity: "info",
        title: serverT("timelineLib.spiked", { label: rule.label(String(row.label)) }),
        detail:
          `${rule.format(Number(row.previous))} → ${rule.format(Number(row.avg_value))} ` +
          `(+${rule.format(jump)})`,
        actor: "",
        source: String(row.metric),
      });
    }
  }

  return entries;
}

const AUDIT_SEVERITY: Record<string, Severity> = {
  ok: "info",
  denied: "warning",
  error: "critical",
};

export function timeline(filter: TimelineFilter = {}): TimelineResult {
  const db = getDb();
  const until = filter.until ?? Math.floor(Date.now() / 1000);
  const since = filter.since ?? until - DEFAULT_WINDOW_SECONDS;
  const limit = Math.min(filter.limit ?? MAX_ENTRIES, MAX_ENTRIES);
  const kinds = new Set<TimelineKind>(filter.kinds ?? ["audit", "event", "spike"]);

  const entries: TimelineEntry[] = [];

  if (kinds.has("event")) {
    const rows = db
      .prepare(
        `SELECT id, ts, severity, title, detail, source, suppressed_reason
         FROM events WHERE host_id = ? AND ts >= ? AND ts <= ? ORDER BY ts`,
      )
      .all(currentHostId(), since, until) as Record<string, string | number | null>[];

    for (const row of rows) {
      entries.push({
        id: `event:${row.id}`,
        ts: Number(row.ts),
        kind: "event",
        severity: String(row.severity) as Severity,
        title: String(row.title),
        detail:
          String(row.detail ?? "") +
          (row.suppressed_reason ? ` · bildirilmedi (${row.suppressed_reason})` : ""),
        actor: "",
        source: String(row.source),
      });
    }
  }

  if (kinds.has("audit")) {
    const rows = db
      .prepare(
        `SELECT id, ts, username, action, target_type, target_id, detail, result
         FROM audit_log WHERE ts >= ? AND ts <= ? ORDER BY ts`,
      )
      .all(since, until) as Record<string, string | number | null>[];

    for (const row of rows) {
      const target = row.target_type ? `${row.target_type}:${row.target_id}` : "";
      entries.push({
        id: `audit:${row.id}`,
        ts: Number(row.ts),
        kind: "audit",
        severity: AUDIT_SEVERITY[String(row.result)] ?? "info",
        title: target ? `${row.action} — ${target}` : String(row.action),
        detail: String(row.detail ?? ""),
        actor: String(row.username ?? ""),
        source: String(row.action),
      });
    }
  }

  if (kinds.has("spike")) entries.push(...findSpikes(since, until));

  const needle = filter.q?.trim() ? fold(filter.q.trim()) : "";
  const filtered = needle
    ? entries.filter((entry) =>
        [entry.title, entry.detail, entry.actor, entry.source].some((text) =>
          fold(text).includes(needle),
        ),
      )
    : entries;

  const counts: Record<TimelineKind, number> = { audit: 0, event: 0, spike: 0 };
  for (const entry of filtered) counts[entry.kind] += 1;

  // En yeni üstte. Kesme de yeni uçtan yapılıyor: aralığın başındaki 500.
  // kayıt yerine sondaki 500 kayıt daha çok işe yarar.
  filtered.sort((a, b) => b.ts - a.ts || a.id.localeCompare(b.id));

  return {
    entries: filtered.slice(0, limit),
    since,
    until,
    counts,
    truncated: filtered.length > limit,
  };
}
