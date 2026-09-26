import "server-only";

import { getDb } from "@/lib/db/client";
import { currentHostId } from "@/lib/hosts/context";
import { getNumber } from "@/lib/settings";
import type { EventRow, Severity } from "./types";

/** Olay kaydı erişimi (M1.3). */

type Row = {
  id: number;
  ts: number;
  alert_key: string;
  source: string;
  severity: string;
  title: string;
  detail: string;
  notified_channels: string;
  suppressed_reason: string | null;
  acknowledged_at: number | null;
  acknowledged_by: string | null;
};

function toEvent(row: Row): EventRow {
  return {
    id: row.id,
    ts: row.ts,
    alertKey: row.alert_key,
    source: row.source,
    severity: row.severity as Severity,
    title: row.title,
    detail: row.detail,
    notifiedChannels: row.notified_channels ? row.notified_channels.split(",") : [],
    suppressedReason: row.suppressed_reason,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedBy: row.acknowledged_by,
  };
}

export type EventInput = {
  ts: number;
  alertKey: string;
  source: string;
  severity: Severity;
  title: string;
  detail: string;
  notifiedChannels: string[];
  suppressedReason: string | null;
};

export function recordEvent(input: EventInput): number {
  const result = getDb()
    .prepare(
      `INSERT INTO events
         (host_id, ts, alert_key, source, severity, title, detail, notified_channels, suppressed_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      // Çoklu sunucu: olay hangi sunucunun bağlamında oluştuysa o.
      currentHostId(),
      input.ts,
      input.alertKey,
      input.source,
      input.severity,
      input.title,
      input.detail,
      input.notifiedChannels.join(","),
      input.suppressedReason,
    );
  return Number(result.lastInsertRowid);
}

export function listEvents(options: {
  limit?: number;
  severity?: Severity;
  source?: string;
  onlyUnacknowledged?: boolean;
  /** Yalnızca bu sunucunun olayları (Olaylar ekranı seçili sunucuyu gösterir). */
  hostId?: number;
}): EventRow[] {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (options.hostId !== undefined) {
    clauses.push("host_id = ?");
    params.push(options.hostId);
  }
  if (options.severity) {
    clauses.push("severity = ?");
    params.push(options.severity);
  }
  if (options.source) {
    clauses.push("source = ?");
    params.push(options.source);
  }
  if (options.onlyUnacknowledged) clauses.push("acknowledged_at IS NULL");

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);

  return (
    getDb()
      .prepare(`SELECT * FROM events ${where} ORDER BY ts DESC, id DESC LIMIT ?`)
      .all(...params, limit) as Row[]
  ).map(toEvent);
}

/**
 * İmleçli sayfa (T12 — /api/v1/events).
 *
 * `listEvents`ten ayrı bir fonksiyon çünkü soru farklı: o "son N olay" diyor
 * ve ekranı besliyor, bu "şu konumdan sonraki N olay" diyor. İkisini tek
 * fonksiyona sıkıştırmak, hiçbir çağıranın tam olarak istemediği bir imza
 * üretirdi.
 *
 * `limit + 1` satır okunuyor: "daha var mı" sorusunu ayrı bir COUNT sorgusu
 * olmadan cevaplamak için. Sayfalama sırası `ts DESC, id DESC` — `id`
 * olmadan aynı saniyedeki kayıtlarda sayfa sınırı belirsiz kalırdı.
 */
export function listEventsPage(options: {
  limit: number;
  severity?: Severity;
  source?: string;
  since?: number;
  until?: number;
  cursor?: { ts: number; id: number };
}): EventRow[] {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (options.severity) {
    clauses.push("severity = ?");
    params.push(options.severity);
  }
  if (options.source) {
    clauses.push("source = ?");
    params.push(options.source);
  }
  if (options.since !== undefined) {
    clauses.push("ts >= ?");
    params.push(options.since);
  }
  if (options.until !== undefined) {
    clauses.push("ts <= ?");
    params.push(options.until);
  }
  if (options.cursor) {
    // İmleç FİLTREYİ değil, filtre içindeki KONUMU taşıyor.
    clauses.push("(ts < ? OR (ts = ? AND id < ?))");
    params.push(options.cursor.ts, options.cursor.ts, options.cursor.id);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  return (
    getDb()
      .prepare(`SELECT * FROM events ${where} ORDER BY ts DESC, id DESC LIMIT ?`)
      .all(...params, options.limit + 1) as Row[]
  ).map(toEvent);
}

/** Okundu işaretleme — tırmandırmayı da durdurur. */
export function acknowledgeEvents(ids: number[], by: string, now: number): number {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(",");
  const result = getDb()
    .prepare(
      `UPDATE events SET acknowledged_at = ?, acknowledged_by = ?
       WHERE id IN (${placeholders}) AND acknowledged_at IS NULL`,
    )
    .run(now, by, ...ids);
  return Number(result.changes);
}

/** Okunmamış uyarı/kritik olay sayısı; `hostId` verilirse yalnızca o sunucunun. */
export function unacknowledgedCount(hostId?: number): number {
  const sql =
    "SELECT COUNT(*) AS n FROM events WHERE acknowledged_at IS NULL AND severity IN ('warning','critical')";
  const row = (
    hostId === undefined
      ? getDb().prepare(sql).get()
      : getDb().prepare(`${sql} AND host_id = ?`).get(hostId)
  ) as { n: number };
  return row.n;
}

export function pruneEvents(now: number = Math.floor(Date.now() / 1000)): number {
  const cutoff = now - getNumber("alerts.retention_months") * 30 * 86400;
  const result = getDb().prepare("DELETE FROM events WHERE ts < ?").run(cutoff);

  /*
    Docker olayları (M3.32) AYRI ve daha kısa bir süre tutuluyor.

    Alarmlar seyrek: haftada birkaç tane. Docker olayları ise her başlat,
    durdur ve yeniden başlatta yazılıyor — yeniden başlama döngüsüne girmiş
    tek bir container günde binlerce satır üretebilir. İkisini aynı kovada
    12 ay tutmak, olay listesini kullanılmaz ve veritabanını gereksiz büyük
    hale getirirdi.
  */
  const dockerCutoff = now - getNumber("docker.events_retention_days") * 86400;
  const dockerResult = getDb()
    .prepare("DELETE FROM events WHERE source = 'docker' AND ts < ?")
    .run(dockerCutoff);

  return Number(result.changes) + Number(dockerResult.changes);
}
