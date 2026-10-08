import "server-only";

import { getDb } from "@/lib/db/client";
import { currentHostId } from "@/lib/hosts/context";
import { serverT } from "@/lib/i18n/runtime";
import {
  DEFAULT_JOB_OPTIONS,
  SYSTEM_CATEGORIES,
  type BackupJob,
  type BackupSource,
  type Category,
  type JobOptions,
  type SourceKind,
  type SourceOptions,
  type SystemCategory,
} from "../types";

/**
 * Yedekleme işleri ve kaynakları.
 *
 * Üç sistem işi (docker/os/database) sunucu başına birer tane; `custom`
 * işler kullanıcının elle tanımladığı tek kaynaklı işler (v1'den gelenler).
 */

type Row = Record<string, string | number | null>;

const SOURCE_KINDS = new Set<SourceKind>(["volume", "host_dir", "panel_db", "container", "db"]);

function parseObject<T extends object>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || raw.length === 0) return { ...fallback };
  try {
    return { ...fallback, ...(JSON.parse(raw) as Partial<T>) };
  } catch {
    return { ...fallback };
  }
}

function loadSources(jobIds: number[]): Map<number, BackupSource[]> {
  const map = new Map<number, BackupSource[]>();
  if (jobIds.length === 0) return map;
  const rows = getDb()
    .prepare(
      `SELECT * FROM backup_sources WHERE job_id IN (${jobIds.map(() => "?").join(",")})
       ORDER BY kind, ref COLLATE NOCASE`,
    )
    .all(...jobIds) as Row[];
  for (const row of rows) {
    const list = map.get(Number(row.job_id)) ?? [];
    list.push({
      id: Number(row.id),
      kind: String(row.kind) as SourceKind,
      ref: String(row.ref),
      enabled: Number(row.enabled) === 1,
      options: parseObject<SourceOptions>(row.options_json, {}),
    });
    map.set(Number(row.job_id), list);
  }
  return map;
}

function toJob(row: Row, sources: BackupSource[]): BackupJob {
  return {
    id: Number(row.id),
    name: String(row.name),
    category: String(row.category) as Category,
    repoId: Number(row.repo_id),
    repoName: String(row.repo_name ?? ""),
    scheduleCron: String(row.schedule_cron),
    keepLast: Number(row.keep_last),
    keepDaily: Number(row.keep_daily),
    keepWeekly: Number(row.keep_weekly),
    keepMonthly: Number(row.keep_monthly),
    notifySuccess: Number(row.notify_success) === 1,
    options: parseObject<JobOptions>(row.options_json, DEFAULT_JOB_OPTIONS),
    quiesce: String(row.quiesce ?? ""),
    enabled: Number(row.enabled) === 1,
    lastRunAt: row.last_run_at === null ? null : Number(row.last_run_at),
    lastStatus: String(row.last_status ?? ""),
    retryAt: row.retry_at === null ? null : Number(row.retry_at),
    attempt: Number(row.attempt ?? 0),
    sources,
  };
}

const SELECT = `SELECT j.*, r.name AS repo_name
                FROM backup_jobs j JOIN backup_repos r ON r.id = j.repo_id`;

export function listJobs(): BackupJob[] {
  const rows = getDb()
    .prepare(`${SELECT} WHERE j.host_id = ? ORDER BY j.category, j.name COLLATE NOCASE`)
    .all(currentHostId()) as Row[];
  const sources = loadSources(rows.map((row) => Number(row.id)));
  return rows.map((row) => toJob(row, sources.get(Number(row.id)) ?? []));
}

export function getJob(id: number): BackupJob | null {
  const row = getDb()
    .prepare(`${SELECT} WHERE j.id = ? AND j.host_id = ?`)
    .get(id, currentHostId()) as Row | undefined;
  if (!row) return null;
  return toJob(row, loadSources([id]).get(id) ?? []);
}

export function getSystemJob(category: SystemCategory): BackupJob | null {
  const row = getDb()
    .prepare(`${SELECT} WHERE j.category = ? AND j.host_id = ?`)
    .get(category, currentHostId()) as Row | undefined;
  if (!row) return null;
  const id = Number(row.id);
  return toJob(row, loadSources([id]).get(id) ?? []);
}

export function isSystemCategory(value: string): value is SystemCategory {
  return (SYSTEM_CATEGORIES as readonly string[]).includes(value);
}

/* --- Sistem işleri (Docker / OS / Veritabanı) --- */

export type SystemSettingsInput = {
  repoId: number;
  scheduleCron: string;
  keepLast: number;
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
  notifySuccess: boolean;
  enabled: boolean;
  options: Partial<JobOptions>;
};

function clampKeep(value: number): number {
  return Math.max(0, Math.min(1000, Math.round(Number(value) || 0)));
}

export function validateSystemSettings(input: SystemSettingsInput): string | null {
  if (!getDb().prepare("SELECT 1 FROM backup_repos WHERE id = ? AND host_id = ?").get(input.repoId, currentHostId())) {
    return serverT("backupStore.repoMissing");
  }
  const keeps = [input.keepLast, input.keepDaily, input.keepWeekly, input.keepMonthly].map(clampKeep);
  if (keeps.every((value) => value === 0)) return serverT("backupStore.retention");
  return null;
}

function cleanOptions(options: Partial<JobOptions>, current: JobOptions = DEFAULT_JOB_OPTIONS): JobOptions {
  const merged = { ...current, ...options };
  return {
    autoInclude: merged.autoInclude !== false,
    retry: merged.retry !== false,
    spaceCheck: merged.spaceCheck !== false,
    lowPriority: merged.lowPriority !== false,
    anomaly: merged.anomaly !== false,
    excludes: (Array.isArray(merged.excludes) ? merged.excludes : [])
      .map((entry) => String(entry).trim())
      .filter((entry) => entry.length > 0)
      .slice(0, 200),
  };
}

/** Sistem işini yaratır ya da ayarlarını günceller; iş kimliğini döndürür. */
export function saveSystemJob(category: SystemCategory, input: SystemSettingsInput): number {
  const db = getDb();
  const existing = getSystemJob(category);
  const values = [
    input.repoId,
    input.scheduleCron.trim(),
    clampKeep(input.keepLast),
    clampKeep(input.keepDaily),
    clampKeep(input.keepWeekly),
    clampKeep(input.keepMonthly),
    input.notifySuccess ? 1 : 0,
    input.enabled ? 1 : 0,
    JSON.stringify(cleanOptions(input.options, existing?.options)),
  ];

  if (existing) {
    db.prepare(
      `UPDATE backup_jobs SET repo_id = ?, schedule_cron = ?, keep_last = ?, keep_daily = ?,
         keep_weekly = ?, keep_monthly = ?, notify_success = ?, enabled = ?, options_json = ?
       WHERE id = ?`,
    ).run(...values, existing.id);
    return existing.id;
  }

  const hostId = currentHostId();
  const info = db
    .prepare(
      `INSERT INTO backup_jobs
         (repo_id, schedule_cron, keep_last, keep_daily, keep_weekly, keep_monthly,
          notify_success, enabled, options_json, host_id, name, category, source_kind, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'multi', '')`,
    )
    .run(...values, hostId, `sys:${category}:${hostId}`, category);
  return Number(info.lastInsertRowid);
}

export type SourceInput = {
  kind: SourceKind;
  ref: string;
  enabled: boolean;
  options?: SourceOptions;
};

/**
 * İşin kaynak listesini verilenle değiştirir. `legacy` işareti korunur —
 * restic'in parent snapshot'ı bulması ona bağlı.
 */
export function replaceSources(jobId: number, sources: SourceInput[]): void {
  const db = getDb();
  const legacy = new Set(
    (db
      .prepare("SELECT kind, ref FROM backup_sources WHERE job_id = ? AND options_json LIKE '%\"legacy\":true%'")
      .all(jobId) as { kind: string; ref: string }[]).map((row) => `${row.kind}\u0000${row.ref}`),
  );

  const insert = db.prepare(
    "INSERT OR REPLACE INTO backup_sources (job_id, kind, ref, enabled, options_json) VALUES (?, ?, ?, ?, ?)",
  );
  // `node:sqlite`te `.transaction()` yardımcısı yok; işlem sınırları elle.
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM backup_sources WHERE job_id = ?").run(jobId);
    for (const source of sources) {
      if (!SOURCE_KINDS.has(source.kind)) continue;
      const options: SourceOptions = { ...(source.options ?? {}) };
      if (legacy.has(`${source.kind}\u0000${source.ref}`)) options.legacy = true;
      insert.run(jobId, source.kind, source.ref.trim(), source.enabled ? 1 : 0, JSON.stringify(options));
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Tek kaynak ekler (ör. otomatik dahil edilen yeni container). */
export function addSource(jobId: number, source: SourceInput): void {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO backup_sources (job_id, kind, ref, enabled, options_json) VALUES (?, ?, ?, ?, ?)",
    )
    .run(jobId, source.kind, source.ref, source.enabled ? 1 : 0, JSON.stringify(source.options ?? {}));
}

/* --- Özel (elle tanımlı) işler --- */

export type CustomJobInput = {
  name: string;
  repoId: number;
  sourceKind: string;
  source: string;
  scheduleCron: string;
  quiesce: string;
  excludes: string;
  keepLast: number;
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
  notifySuccess: boolean;
  enabled: boolean;
};

export function validateCustomJob(input: CustomJobInput, id?: number): string | null {
  if (input.name.trim().length < 2) return serverT("backupStore.jobName");
  if (!["volume", "host_dir"].includes(input.sourceKind)) return serverT("backupStore.sourceKind");
  if (input.sourceKind === "host_dir") {
    const path = input.source.trim();
    if (!path.startsWith("/") || path.includes("..")) return serverT("backupStore.hostPath");
  }
  if (input.sourceKind === "volume" && input.source.trim().length === 0) {
    return serverT("backupStore.volumeRequired");
  }
  if ([input.keepLast, input.keepDaily, input.keepWeekly, input.keepMonthly].map(clampKeep).every((v) => v === 0)) {
    return serverT("backupStore.retention");
  }
  if (!getDb().prepare("SELECT 1 FROM backup_repos WHERE id = ? AND host_id = ?").get(input.repoId, currentHostId())) {
    return serverT("backupStore.repoMissing");
  }
  const clash = getDb()
    .prepare("SELECT id FROM backup_jobs WHERE name = ?")
    .get(input.name.trim()) as { id: number } | undefined;
  if (clash && clash.id !== id) return serverT("backupStore.jobNameTaken");
  return null;
}

function customValues(input: CustomJobInput): (string | number)[] {
  return [
    input.name.trim(),
    input.repoId,
    input.sourceKind,
    input.source.trim(),
    input.scheduleCron.trim(),
    input.quiesce.trim(),
    clampKeep(input.keepLast),
    clampKeep(input.keepDaily),
    clampKeep(input.keepWeekly),
    clampKeep(input.keepMonthly),
    input.notifySuccess ? 1 : 0,
    input.enabled ? 1 : 0,
    JSON.stringify(
      cleanOptions({
        excludes: input.excludes.split("\n"),
        autoInclude: false,
      }),
    ),
  ];
}

export function createCustomJob(input: CustomJobInput): number {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO backup_jobs
         (name, repo_id, source_kind, source, schedule_cron, quiesce, keep_last, keep_daily,
          keep_weekly, keep_monthly, notify_success, enabled, options_json, host_id, category)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'custom')`,
    )
    .run(...customValues(input), currentHostId());
  const id = Number(info.lastInsertRowid);
  replaceSources(id, [{ kind: input.sourceKind as SourceKind, ref: input.source, enabled: true }]);
  return id;
}

export function updateCustomJob(id: number, input: CustomJobInput): boolean {
  const changes = getDb()
    .prepare(
      `UPDATE backup_jobs SET name = ?, repo_id = ?, source_kind = ?, source = ?, schedule_cron = ?,
         quiesce = ?, keep_last = ?, keep_daily = ?, keep_weekly = ?, keep_monthly = ?,
         notify_success = ?, enabled = ?, options_json = ?
       WHERE id = ? AND host_id = ? AND category = 'custom'`,
    )
    .run(...customValues(input), id, currentHostId()).changes;
  if (Number(changes) === 0) return false;
  replaceSources(id, [{ kind: input.sourceKind as SourceKind, ref: input.source, enabled: true }]);
  return true;
}

export function deleteJob(id: number): boolean {
  return (
    Number(
      getDb().prepare("DELETE FROM backup_jobs WHERE id = ? AND host_id = ?").run(id, currentHostId()).changes,
    ) > 0
  );
}

export function setJobEnabled(id: number, enabled: boolean): void {
  getDb()
    .prepare("UPDATE backup_jobs SET enabled = ? WHERE id = ? AND host_id = ?")
    .run(enabled ? 1 : 0, id, currentHostId());
}

/** Başarısız koşudan sonra yeniden deneme planı; `null` planı temizler. */
export function setRetry(jobId: number, retryAt: number | null, attempt: number): void {
  getDb().prepare("UPDATE backup_jobs SET retry_at = ?, attempt = ? WHERE id = ?").run(retryAt, attempt, jobId);
}
