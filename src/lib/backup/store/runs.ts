import "server-only";

import { getDb } from "@/lib/db/client";
import { currentHostId } from "@/lib/hosts/context";
import type { BackupRun, Category, RunKind, RunStatus } from "../types";

/** Yedekleme / geri yükleme / doğrulama koşularının geçmişi. */

type Row = Record<string, string | number | null>;

const LOG_LIMIT = 8 * 1024;

export function startRun(jobId: number, kind: RunKind, actor: string, attempt = 1): number {
  const info = getDb()
    .prepare("INSERT INTO backup_runs (host_id, job_id, kind, actor, attempt) VALUES (?, ?, ?, ?, ?)")
    .run(currentHostId(), jobId, kind, actor, attempt);
  return Number(info.lastInsertRowid);
}

export type RunOutcome = {
  status: Exclude<RunStatus, "running">;
  snapshotId?: string;
  filesNew?: number;
  filesChanged?: number;
  bytesAdded?: number;
  bytesProcessed?: number;
  filesTotal?: number;
  durationMs: number;
  pruned?: number;
  detail: string;
  anomaly?: string;
  log?: string;
};

export function finishRun(runId: number, outcome: RunOutcome): void {
  const db = getDb();
  db.prepare(
    `UPDATE backup_runs
     SET finished_at = unixepoch(), status = ?, snapshot_id = ?, files_new = ?, files_changed = ?,
         bytes_added = ?, bytes_processed = ?, files_total = ?, duration_ms = ?, pruned = ?,
         detail = ?, anomaly = ?, log = ?
     WHERE id = ?`,
  ).run(
    outcome.status,
    outcome.snapshotId ?? "",
    outcome.filesNew ?? 0,
    outcome.filesChanged ?? 0,
    outcome.bytesAdded ?? 0,
    outcome.bytesProcessed ?? 0,
    outcome.filesTotal ?? 0,
    outcome.durationMs,
    outcome.pruned ?? 0,
    outcome.detail.slice(0, 4000),
    outcome.anomaly ?? "",
    (outcome.log ?? "").slice(-LOG_LIMIT),
    runId,
  );

  const run = db.prepare("SELECT job_id, kind FROM backup_runs WHERE id = ?").get(runId) as
    | { job_id: number; kind: string }
    | undefined;
  // İşin "son durumu" yalnızca yedekleme koşularından gelir: başarılı bir
  // geri yükleme, başarısız bir yedeği yeşile boyamamalı.
  if (run && run.kind === "backup") {
    db.prepare("UPDATE backup_jobs SET last_run_at = unixepoch(), last_status = ? WHERE id = ?").run(
      outcome.status,
      run.job_id,
    );
  }
}

function toRun(row: Row): BackupRun {
  return {
    id: Number(row.id),
    jobId: Number(row.job_id),
    jobName: String(row.job_name ?? ""),
    category: String(row.category ?? "custom") as Category,
    kind: String(row.kind ?? "backup") as RunKind,
    startedAt: Number(row.started_at),
    finishedAt: row.finished_at === null ? null : Number(row.finished_at),
    status: String(row.status) as RunStatus,
    snapshotId: String(row.snapshot_id ?? ""),
    filesNew: Number(row.files_new ?? 0),
    filesChanged: Number(row.files_changed ?? 0),
    bytesAdded: Number(row.bytes_added ?? 0),
    bytesProcessed: Number(row.bytes_processed ?? 0),
    filesTotal: Number(row.files_total ?? 0),
    durationMs: Number(row.duration_ms ?? 0),
    pruned: Number(row.pruned ?? 0),
    detail: String(row.detail ?? ""),
    actor: String(row.actor ?? ""),
    attempt: Number(row.attempt ?? 1),
    anomaly: String(row.anomaly ?? ""),
  };
}

export type RunFilter = {
  jobId?: number;
  category?: Category;
  kind?: RunKind;
  status?: RunStatus;
  limit?: number;
  offset?: number;
  /** Yalnızca bu andan (unix sn) sonra başlayanlar. */
  since?: number;
};

export function listRuns(filter: RunFilter = {}): { runs: BackupRun[]; total: number } {
  const where = ["r.host_id = ?"];
  const params: (string | number)[] = [currentHostId()];
  if (filter.jobId !== undefined) {
    where.push("r.job_id = ?");
    params.push(filter.jobId);
  }
  if (filter.category) {
    where.push("j.category = ?");
    params.push(filter.category);
  }
  if (filter.kind) {
    where.push("r.kind = ?");
    params.push(filter.kind);
  }
  if (filter.status) {
    where.push("r.status = ?");
    params.push(filter.status);
  }
  if (filter.since !== undefined) {
    where.push("r.started_at >= ?");
    params.push(filter.since);
  }
  const clause = `FROM backup_runs r JOIN backup_jobs j ON j.id = r.job_id WHERE ${where.join(" AND ")}`;
  const limit = Math.max(1, Math.min(500, filter.limit ?? 50));
  const offset = Math.max(0, filter.offset ?? 0);

  const db = getDb();
  const total = Number((db.prepare(`SELECT COUNT(*) AS n ${clause}`).get(...params) as { n: number }).n);
  const runs = (
    db
      .prepare(
        `SELECT r.*, j.name AS job_name, j.category ${clause}
         ORDER BY r.started_at DESC, r.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as Row[]
  ).map(toRun);
  return { runs, total };
}

export function getRun(id: number): (BackupRun & { log: string }) | null {
  const row = getDb()
    .prepare(
      `SELECT r.*, j.name AS job_name, j.category FROM backup_runs r
       JOIN backup_jobs j ON j.id = r.job_id WHERE r.id = ? AND r.host_id = ?`,
    )
    .get(id, currentHostId()) as Row | undefined;
  return row ? { ...toRun(row), log: String(row.log ?? "") } : null;
}

/** Son N başarılı yedek — anormal boyut karşılaştırması için. */
export function recentSuccessfulBackups(jobId: number, limit = 10): BackupRun[] {
  return (
    getDb()
      .prepare(
        `SELECT r.*, j.name AS job_name, j.category FROM backup_runs r
         JOIN backup_jobs j ON j.id = r.job_id
         WHERE r.job_id = ? AND r.kind = 'backup' AND r.status IN ('ok', 'warning')
         ORDER BY r.started_at DESC LIMIT ?`,
      )
      .all(jobId, limit) as Row[]
  ).map(toRun);
}

/** İşin son başarılı yedeği (unix sn); hiç yoksa null. */
export function lastSuccessAt(jobId: number): number | null {
  const row = getDb()
    .prepare(
      `SELECT MAX(finished_at) AS ts FROM backup_runs
       WHERE job_id = ? AND kind = 'backup' AND status IN ('ok', 'warning')`,
    )
    .get(jobId) as { ts: number | null };
  return row.ts === null ? null : Number(row.ts);
}

/**
 * Yedek takibi (watch.ts) bu motorun çıktısını okuyor: sunucunun en son
 * BAŞARILI yedeğinin zamanı. Hiç yoksa null.
 */
export function lastSuccessfulRunAt(): number | null {
  const row = getDb()
    .prepare(
      `SELECT MAX(finished_at) AS ts FROM backup_runs
       WHERE kind = 'backup' AND status IN ('ok', 'warning') AND host_id = ?`,
    )
    .get(currentHostId()) as { ts: number | null };
  return row.ts === null ? null : Number(row.ts);
}

/** Son 30 günün başarılı/başarısız yedek sayıları — Genel Bakış için. */
export function successRate(sinceSeconds: number): { ok: number; failed: number } {
  const row = getDb()
    .prepare(
      `SELECT SUM(CASE WHEN status IN ('ok','warning') THEN 1 ELSE 0 END) AS ok,
              SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS failed
       FROM backup_runs WHERE kind = 'backup' AND host_id = ? AND started_at >= ?`,
    )
    .get(currentHostId(), sinceSeconds) as { ok: number | null; failed: number | null };
  return { ok: Number(row.ok ?? 0), failed: Number(row.failed ?? 0) };
}

/**
 * Panel yeniden başlarken yarıda kalan koşular "running" olarak asılı
 * kalıyor; canlı kayıtta olmayanlar hata olarak kapatılır.
 */
export function closeOrphanRuns(activeRunIds: Set<number>, detail: string): number {
  const rows = getDb()
    .prepare("SELECT id FROM backup_runs WHERE status = 'running' AND host_id = ?")
    .all(currentHostId()) as { id: number }[];
  let closed = 0;
  for (const row of rows) {
    if (activeRunIds.has(Number(row.id))) continue;
    getDb()
      .prepare(
        "UPDATE backup_runs SET status = 'error', finished_at = unixepoch(), detail = ? WHERE id = ?",
      )
      .run(detail, row.id);
    closed += 1;
  }
  return closed;
}
