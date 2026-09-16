import "server-only";

import { getDb } from "@/lib/db/client";
import { serverT } from "@/lib/i18n/runtime";
import { getNumber } from "@/lib/settings";
import { isInMaintenance } from "./maintenance";
import { MONITOR_TYPES } from "./types";
import type {
  Monitor,
  MonitorEffective,
  MonitorStatus,
  MonitorType,
  MonitorView,
  UptimeDay,
} from "./types";

/** Veritabanı erişimi ve kullanılabilirlik hesabı (M1.2). */

type Row = {
  id: number;
  name: string;
  type: string;
  target: string;
  expected: string;
  enabled: number;
  ignore_tls: number;
  interval_seconds: number | null;
  timeout_seconds: number | null;
  retries: number | null;
  down_threshold: number | null;
  status: string;
  consecutive_fails: number;
  consecutive_ok: number;
  last_check_at: number | null;
  last_change_at: number | null;
  last_latency_ms: number | null;
  last_error: string | null;
  next_check_at: number | null;
  sort_order: number;
};

function toMonitor(row: Row): Monitor {
  return {
    id: row.id,
    name: row.name,
    type: row.type as MonitorType,
    target: row.target,
    expected: row.expected,
    enabled: row.enabled === 1,
    ignoreTls: row.ignore_tls === 1,
    intervalSeconds: row.interval_seconds,
    timeoutSeconds: row.timeout_seconds,
    retries: row.retries,
    downThreshold: row.down_threshold,
    status: row.status as MonitorStatus,
    consecutiveFails: row.consecutive_fails,
    consecutiveOk: row.consecutive_ok,
    lastCheckAt: row.last_check_at,
    lastChangeAt: row.last_change_at,
    lastLatencyMs: row.last_latency_ms,
    lastError: row.last_error,
    nextCheckAt: row.next_check_at,
    sortOrder: row.sort_order,
  };
}

export function listMonitors(): Monitor[] {
  return (
    getDb()
      .prepare("SELECT * FROM monitors ORDER BY sort_order, name")
      .all() as Row[]
  ).map(toMonitor);
}

export function getMonitor(id: number): Monitor | null {
  const row = getDb().prepare("SELECT * FROM monitors WHERE id = ?").get(id) as
    | Row
    | undefined;
  return row ? toMonitor(row) : null;
}

/** Monitörün kendi değeri yoksa ayarlardaki global değer kullanılır (T9). */
export function effectiveSettings(monitor: Monitor): MonitorEffective {
  return {
    intervalSeconds: monitor.intervalSeconds ?? getNumber("health.interval"),
    timeoutSeconds: monitor.timeoutSeconds ?? getNumber("health.timeout"),
    retries: monitor.retries ?? getNumber("health.retries"),
    downThreshold: monitor.downThreshold ?? getNumber("health.down_threshold"),
  };
}

// --- CRUD ------------------------------------------------------------------

export type MonitorInput = {
  name: string;
  type: MonitorType;
  target: string;
  expected: string;
  enabled: boolean;
  ignoreTls: boolean;
  intervalSeconds: number | null;
  timeoutSeconds: number | null;
  retries: number | null;
  downThreshold: number | null;
};

export function validateMonitor(input: MonitorInput): string | null {
  if (!input.name.trim()) return serverT("monitorStore.nameEmpty");
  if (!input.target.trim()) return serverT("monitorStore.targetEmpty");

  if (input.type === "http") {
    try {
      const url = new URL(input.target);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return serverT("monitorStore.httpScheme");
      }
    } catch {
      return serverT("monitorStore.invalidUrl");
    }
  }

  if (input.type === "tcp" && !/^.+:\d+$/.test(input.target.trim())) {
    return serverT("monitorStore.tcpFormat");
  }

  for (const [label, value, min, max] of [
    [serverT("monitorStore.interval"), input.intervalSeconds, 10, 3600],
    [serverT("monitorForm.timeout"), input.timeoutSeconds, 1, 120],
    [serverT("monitorForm.retries"), input.retries, 0, 10],
    [serverT("monitorForm.downThreshold"), input.downThreshold, 1, 20],
  ] as const) {
    if (value !== null && (!Number.isInteger(value) || value < min || value > max)) {
      return serverT("monitorStore.range", { label, min, max });
    }
  }

  return null;
}

export function createMonitor(input: MonitorInput): number {
  const result = getDb()
    .prepare(
      `INSERT INTO monitors
         (name, type, target, expected, enabled, ignore_tls,
          interval_seconds, timeout_seconds, retries, down_threshold, next_check_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`,
    )
    .run(
      input.name.trim(),
      input.type,
      input.target.trim(),
      input.expected.trim(),
      input.enabled ? 1 : 0,
      input.ignoreTls ? 1 : 0,
      input.intervalSeconds,
      input.timeoutSeconds,
      input.retries,
      input.downThreshold,
    );
  return Number(result.lastInsertRowid);
}

export function updateMonitor(id: number, input: MonitorInput): void {
  // Hedef değişince geçmiş durum artık aynı şeyi anlatmıyor; bir sonraki tur
  // sıfırdan değerlendirsin diye sayaçlar sıfırlanıyor.
  getDb()
    .prepare(
      `UPDATE monitors
       SET name = ?, type = ?, target = ?, expected = ?, enabled = ?, ignore_tls = ?,
           interval_seconds = ?, timeout_seconds = ?, retries = ?, down_threshold = ?,
           next_check_at = unixepoch()
       WHERE id = ?`,
    )
    .run(
      input.name.trim(),
      input.type,
      input.target.trim(),
      input.expected.trim(),
      input.enabled ? 1 : 0,
      input.ignoreTls ? 1 : 0,
      input.intervalSeconds,
      input.timeoutSeconds,
      input.retries,
      input.downThreshold,
      id,
    );
}

export function deleteMonitor(id: number): void {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    // uptime_log ve maintenance_windows CASCADE ile gider; metrik satırları
    // yabancı anahtar taşımadığı için elle siliniyor.
    db.prepare("DELETE FROM metrics_raw WHERE metric = 'monitor.latency' AND label = ?").run(
      String(id),
    );
    for (const table of ["metrics_1m", "metrics_1h", "metrics_1d"]) {
      db.prepare(
        `DELETE FROM ${table} WHERE metric = 'monitor.latency' AND label = ?`,
      ).run(String(id));
    }
    db.prepare("DELETE FROM monitors WHERE id = ?").run(id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

// --- Kontrol sonucunu işleme ----------------------------------------------

export type RecordOutcome = {
  status: MonitorStatus;
  /** Günlüğe yeni bir satır düştü mü (durum değişimi). */
  changed: boolean;
  inMaintenance: boolean;
};

export function recordCheck(
  monitor: Monitor,
  result: { ok: boolean; latencyMs: number; error?: string },
  now: number = Math.floor(Date.now() / 1000),
): RecordOutcome {
  const db = getDb();
  const effective = effectiveSettings(monitor);
  const inMaintenance = isInMaintenance(monitor.id, new Date(now * 1000));

  const consecutiveFails = result.ok ? 0 : monitor.consecutiveFails + 1;

  // Başarı anında yukarı çıkar; düşüş için eşik kadar ARDIŞIK hata beklenir —
  // tek bir ağ hıçkırığı servisi çevrimdışı göstermesin (flap koruması).
  let status: MonitorStatus;
  if (result.ok) {
    status = "up";
  } else if (consecutiveFails >= effective.downThreshold) {
    status = "down";
  } else {
    status = monitor.status;
  }

  const logStatus = inMaintenance ? "bakim" : status;
  const lastLog = db
    .prepare("SELECT status FROM uptime_log WHERE monitor_id = ? ORDER BY ts DESC LIMIT 1")
    .get(monitor.id) as { status: string } | undefined;

  // "bilinmiyor" günlüğe yazılmaz: henüz bir şey bilmiyorsak kullanılabilirlik
  // hesabına da girmemeli.
  const changed = logStatus !== "bilinmiyor" && lastLog?.status !== logStatus;

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `UPDATE monitors
       SET status = ?, consecutive_fails = ?, consecutive_ok = ?,
           last_check_at = ?, last_latency_ms = ?, last_error = ?,
           next_check_at = ?, last_change_at = COALESCE(?, last_change_at)
       WHERE id = ?`,
    ).run(
      status,
      consecutiveFails,
      result.ok ? monitor.consecutiveOk + 1 : 0,
      now,
      result.ok ? result.latencyMs : null,
      result.error ?? null,
      now + effective.intervalSeconds,
      changed ? now : null,
      monitor.id,
    );

    if (changed) {
      db.prepare(
        `INSERT OR REPLACE INTO uptime_log (monitor_id, ts, status, latency_ms, error)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(monitor.id, now, logStatus, result.ok ? result.latencyMs : null, result.error ?? null);
    }

    // Gecikme, T1 metrik hattına yazılıyor: rollup, budama, grafik ve saklama
    // süresi bedava geliyor. Ayrı bir zaman serisi tablosu gerekmiyor.
    if (result.ok) {
      db.prepare(
        `INSERT OR REPLACE INTO metrics_raw (host_id, metric, label, ts, value)
         VALUES (1, 'monitor.latency', ?, ?, ?)`,
      ).run(String(monitor.id), now, result.latencyMs);
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return { status, changed, inMaintenance };
}

// --- Kullanılabilirlik -----------------------------------------------------

/**
 * Durum değişimi günlüğünü aralıklara açar.
 *
 * İlk olaydan ÖNCEKİ zaman bilinmiyor sayılır ve hiçbir kovaya yazılmaz:
 * monitör yeni eklendiyse "%100 çalışıyor" demek yanlış olurdu.
 */
function walkSegments(
  monitorId: number,
  from: number,
  to: number,
  onSegment: (start: number, end: number, status: string) => void,
): void {
  const db = getDb();

  const initial = db
    .prepare(
      "SELECT status FROM uptime_log WHERE monitor_id = ? AND ts <= ? ORDER BY ts DESC LIMIT 1",
    )
    .get(monitorId, from) as { status: string } | undefined;

  const events = db
    .prepare(
      "SELECT ts, status FROM uptime_log WHERE monitor_id = ? AND ts > ? AND ts <= ? ORDER BY ts",
    )
    .all(monitorId, from, to) as { ts: number; status: string }[];

  let cursor = from;
  let status: string | null = initial?.status ?? null;

  for (const event of events) {
    if (status !== null && event.ts > cursor) onSegment(cursor, event.ts, status);
    cursor = event.ts;
    status = event.status;
  }

  if (status !== null && to > cursor) onSegment(cursor, to, status);
}

export type UptimeSummary = {
  upSeconds: number;
  downSeconds: number;
  maintenanceSeconds: number;
  /** Bakım süresi hariç kullanılabilirlik; hiç veri yoksa null. */
  pct: number | null;
};

export function uptimeSummary(monitorId: number, from: number, to: number): UptimeSummary {
  let up = 0;
  let down = 0;
  let maintenance = 0;

  walkSegments(monitorId, from, to, (start, end, status) => {
    const seconds = end - start;
    if (status === "up") up += seconds;
    else if (status === "down") down += seconds;
    else if (status === "bakim") maintenance += seconds;
  });

  const measured = up + down;
  return {
    upSeconds: up,
    downSeconds: down,
    maintenanceSeconds: maintenance,
    pct: measured > 0 ? (up / measured) * 100 : null,
  };
}

/** Günlük kullanılabilirlik şeridi (yerel saat dilimine göre gün sınırları). */
export function uptimeDays(monitorId: number, dayCount: number): UptimeDay[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const firstDay = new Date(todayStart);
  firstDay.setDate(firstDay.getDate() - (dayCount - 1));

  const buckets = new Map<string, { up: number; down: number; maintenance: number }>();
  const keyOf = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

  const days: UptimeDay[] = [];
  for (let i = 0; i < dayCount; i++) {
    const date = new Date(firstDay);
    date.setDate(date.getDate() + i);
    buckets.set(keyOf(date), { up: 0, down: 0, maintenance: 0 });
  }

  walkSegments(
    monitorId,
    Math.floor(firstDay.getTime() / 1000),
    Math.floor(now.getTime() / 1000),
    (start, end, status) => {
      // Bir aralık gün sınırını aşabilir; gün gün bölerek dağıt.
      let cursor = start;
      while (cursor < end) {
        const date = new Date(cursor * 1000);
        const dayEnd = Math.floor(
          new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime() / 1000,
        );
        const slice = Math.min(end, dayEnd) - cursor;
        const bucket = buckets.get(keyOf(date));
        if (bucket) {
          if (status === "up") bucket.up += slice;
          else if (status === "down") bucket.down += slice;
          else if (status === "bakim") bucket.maintenance += slice;
        }
        cursor += slice;
      }
    },
  );

  for (const [date, bucket] of buckets) {
    const measured = bucket.up + bucket.down;
    days.push({
      date,
      upPct: measured > 0 ? (bucket.up / measured) * 100 : null,
      downSeconds: bucket.down,
      maintenanceSeconds: bucket.maintenance,
    });
  }

  return days;
}

export function monitorViews(dayCount = 60): MonitorView[] {
  const now = Math.floor(Date.now() / 1000);
  const at = new Date(now * 1000);

  return listMonitors().map((monitor) => ({
    ...monitor,
    effective: effectiveSettings(monitor),
    uptime24h: uptimeSummary(monitor.id, now - 86400, now).pct,
    uptime30d: uptimeSummary(monitor.id, now - 30 * 86400, now).pct,
    days: uptimeDays(monitor.id, dayCount),
    inMaintenance: isInMaintenance(monitor.id, at),
  }));
}

/** Saklama süresini aşan uptime kayıtlarını siler (ayarlardan). */
export function pruneUptime(now: number = Math.floor(Date.now() / 1000)): number {
  const months = getNumber("health.uptime_retention_months");
  const cutoff = now - months * 30 * 86400;

  // En son olay her monitör için KORUNUR: silinirse o monitörün mevcut durumu
  // "bilinmiyor" olur ve şerit boşalır.
  const result = getDb()
    .prepare(
      `DELETE FROM uptime_log
       WHERE ts < ?
         AND ts NOT IN (SELECT MAX(ts) FROM uptime_log GROUP BY monitor_id)`,
    )
    .run(cutoff);

  return Number(result.changes);
}

// --- Gövde ayrıştırma ------------------------------------------------------

/**
 * Gövdeden monitör girdisi üretir; biçim hatasında mesaj döner (M1.2).
 *
 * Route dosyasından BURAYA taşındı (T12/Faz D): artık iki farklı yüzey
 * kullanıyor — panelin kendi `/api/monitors` ucu ve dışa açık
 * `/api/v1/monitors`. İkisinin aynı doğrulamadan geçmesi şart; ayrı
 * kopyalar tutulsaydı biri sıkılaşırken diğeri gevşek kalırdı ve dış yüzey
 * panelin kabul etmediği bir kaydı yazabilirdi.
 */
export function parseMonitorInput(
  body: Record<string, unknown>,
): { ok: true; input: MonitorInput } | { ok: false; error: string } {
  if (typeof body.name !== "string" || typeof body.target !== "string") {
    return { ok: false, error: serverT("monitorStore.nameTargetRequired") };
  }
  if (!MONITOR_TYPES.some((t) => t.value === body.type)) {
    return { ok: false, error: serverT("monitorStore.invalidType") };
  }

  const input: MonitorInput = {
    name: String(body.name ?? ""),
    type: body.type as MonitorType,
    target: String(body.target ?? ""),
    expected: String(body.expected ?? ""),
    enabled: body.enabled !== false,
    ignoreTls: body.ignoreTls === true,
    intervalSeconds: optionalNumber(body.intervalSeconds),
    timeoutSeconds: optionalNumber(body.timeoutSeconds),
    retries: optionalNumber(body.retries),
    downThreshold: optionalNumber(body.downThreshold),
  };

  const problem = validateMonitor(input);
  return problem ? { ok: false, error: problem } : { ok: true, input };
}

/** null gelirse "ayardaki global değeri kullan" demektir (T9 ezme). */
function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
