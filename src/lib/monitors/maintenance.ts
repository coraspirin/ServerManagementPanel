import "server-only";

import { getDb } from "@/lib/db/client";
import type { MaintenanceKind, MaintenanceWindow } from "./types";

/**
 * Bakım pencereleri (M1.2).
 *
 * Pencere içindeyken kontrol yine yapılır — servisin gerçekten ne zaman geri
 * geldiğini görmek isteriz — ama durum değişimi "bakim" olarak günlüğe düşer,
 * kullanılabilirlik hesabından çıkarılır ve (M1.3'ten itibaren) bildirim üretmez.
 */

type Row = {
  id: number;
  name: string;
  kind: string;
  starts_at: number | null;
  ends_at: number | null;
  weekdays: string;
  start_minute: number | null;
  end_minute: number | null;
  monitor_id: number | null;
  enabled: number;
};

function toWindow(row: Row, at: Date): MaintenanceWindow {
  const window: Omit<MaintenanceWindow, "active"> = {
    id: row.id,
    name: row.name,
    kind: row.kind as MaintenanceKind,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    weekdays: row.weekdays
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6),
    startMinute: row.start_minute,
    endMinute: row.end_minute,
    monitorId: row.monitor_id,
    enabled: row.enabled === 1,
  };

  return { ...window, active: isWindowActive(window, at) };
}

export function isWindowActive(
  window: Omit<MaintenanceWindow, "active">,
  at: Date,
): boolean {
  if (!window.enabled) return false;

  if (window.kind === "once") {
    if (window.startsAt === null || window.endsAt === null) return false;
    const ts = Math.floor(at.getTime() / 1000);
    return ts >= window.startsAt && ts < window.endsAt;
  }

  if (window.startMinute === null || window.endMinute === null) return false;
  if (window.weekdays.length === 0) return false;

  const minute = at.getHours() * 60 + at.getMinutes();
  const day = at.getDay();

  if (window.startMinute <= window.endMinute) {
    return window.weekdays.includes(day) && minute >= window.startMinute && minute < window.endMinute;
  }

  // Gece yarısını aşan pencere (ör. 23:00–02:00): bugünün başlangıcı ya da
  // dünkü pencerenin bugüne taşan kuyruğu.
  const previousDay = (day + 6) % 7;
  return (
    (window.weekdays.includes(day) && minute >= window.startMinute) ||
    (window.weekdays.includes(previousDay) && minute < window.endMinute)
  );
}

export function listMaintenanceWindows(at: Date = new Date()): MaintenanceWindow[] {
  const rows = getDb()
    .prepare("SELECT * FROM maintenance_windows ORDER BY name")
    .all() as Row[];
  return rows.map((row) => toWindow(row, at));
}

/**
 * Verilen monitör şu an bir bakım penceresinin içinde mi?
 *
 * `monitorId` null verilirse (ör. disk doluluğu gibi monitöre bağlı olmayan bir
 * alarm) yalnızca TÜM servisleri kapsayan pencereler dikkate alınır.
 */
export function isInMaintenance(
  monitorId: number | null,
  at: Date = new Date(),
): boolean {
  return listMaintenanceWindows(at).some(
    (w) => w.active && (w.monitorId === null || w.monitorId === monitorId),
  );
}

export type MaintenanceInput = {
  name: string;
  kind: MaintenanceKind;
  startsAt: number | null;
  endsAt: number | null;
  weekdays: number[];
  startMinute: number | null;
  endMinute: number | null;
  monitorId: number | null;
  enabled: boolean;
};

/** Kaydetmeden önce doğrular; sorun varsa açıklayıcı mesaj döner. */
export function validateMaintenance(input: MaintenanceInput): string | null {
  if (!input.name.trim()) return "Ad boş olamaz.";

  if (input.kind === "once") {
    if (input.startsAt === null || input.endsAt === null) {
      return "Başlangıç ve bitiş zamanı gerekli.";
    }
    if (input.endsAt <= input.startsAt) return "Bitiş, başlangıçtan sonra olmalı.";
    return null;
  }

  if (input.weekdays.length === 0) return "En az bir gün seçilmeli.";
  if (input.startMinute === null || input.endMinute === null) {
    return "Başlangıç ve bitiş saati gerekli.";
  }
  if (input.startMinute === input.endMinute) {
    return "Başlangıç ve bitiş saati aynı olamaz.";
  }
  return null;
}

export function createMaintenance(input: MaintenanceInput): number {
  const result = getDb()
    .prepare(
      `INSERT INTO maintenance_windows
         (name, kind, starts_at, ends_at, weekdays, start_minute, end_minute, monitor_id, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.name.trim(),
      input.kind,
      input.startsAt,
      input.endsAt,
      input.weekdays.join(","),
      input.startMinute,
      input.endMinute,
      input.monitorId,
      input.enabled ? 1 : 0,
    );
  return Number(result.lastInsertRowid);
}

export function updateMaintenance(id: number, input: MaintenanceInput): void {
  getDb()
    .prepare(
      `UPDATE maintenance_windows
       SET name = ?, kind = ?, starts_at = ?, ends_at = ?, weekdays = ?,
           start_minute = ?, end_minute = ?, monitor_id = ?, enabled = ?
       WHERE id = ?`,
    )
    .run(
      input.name.trim(),
      input.kind,
      input.startsAt,
      input.endsAt,
      input.weekdays.join(","),
      input.startMinute,
      input.endMinute,
      input.monitorId,
      input.enabled ? 1 : 0,
      id,
    );
}

export function deleteMaintenance(id: number): void {
  getDb().prepare("DELETE FROM maintenance_windows WHERE id = ?").run(id);
}

// --- Gövde ayrıştırma ------------------------------------------------------

/**
 * Gövdeden bakım penceresi girdisi üretir.
 *
 * Route dosyasından buraya taşındı (T12/Faz D) — iç uç ve
 * `/api/v1/maintenance` aynı doğrulamayı paylaşmalı.
 */
export function parseMaintenanceInput(
  body: Record<string, unknown>,
): { ok: true; input: MaintenanceInput } | { ok: false; error: string } {
  const kind: MaintenanceKind = body.kind === "weekly" ? "weekly" : "once";

  const input: MaintenanceInput = {
    name: String(body.name ?? ""),
    kind,
    startsAt: numberOrNull(body.startsAt),
    endsAt: numberOrNull(body.endsAt),
    weekdays: Array.isArray(body.weekdays)
      ? body.weekdays.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
      : [],
    startMinute: numberOrNull(body.startMinute),
    endMinute: numberOrNull(body.endMinute),
    monitorId: numberOrNull(body.monitorId),
    enabled: body.enabled !== false,
  };

  const problem = validateMaintenance(input);
  return problem ? { ok: false, error: problem } : { ok: true, input };
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
