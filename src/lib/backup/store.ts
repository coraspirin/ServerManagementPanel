import "server-only";
import { serverT } from "@/lib/i18n/runtime";

import { getDb } from "@/lib/db/client";
import { decryptSecret, encryptSecret, type EncryptedValue } from "@/lib/crypto";
import type {
  BackupJob,
  BackupRepo,
  BackupRun,
  RepoKind,
  RunStatus,
  SourceKind,
} from "./types";

/** M3.4 — yedekleme deposu, işleri ve çalışma geçmişi. */

const REPO_KINDS = new Set<RepoKind>(["local", "rclone", "s3"]);
const SOURCE_KINDS = new Set<SourceKind>(["volume", "host_dir", "panel_db"]);

function readEncrypted(raw: string): string | null {
  if (!raw) return null;
  try {
    return decryptSecret(JSON.parse(raw) as EncryptedValue);
  } catch {
    return null;
  }
}

export function listRepos(): BackupRepo[] {
  return (
    getDb()
      .prepare(
        `SELECT r.id, r.name, r.kind, r.location, r.password_enc, r.initialized,
                r.last_check_at, r.last_error,
                (SELECT COUNT(*) FROM backup_jobs j WHERE j.repo_id = r.id) AS job_count
         FROM backup_repos r ORDER BY r.name COLLATE NOCASE`,
      )
      .all() as Record<string, string | number | null>[]
  ).map((row) => {
    const enc = String(row.password_enc ?? "");
    return {
      id: Number(row.id),
      name: String(row.name),
      kind: String(row.kind) as RepoKind,
      location: String(row.location),
      hasPassword: enc.length > 0,
      passwordReadable: enc.length > 0 && readEncrypted(enc) !== null,
      initialized: Number(row.initialized) === 1,
      lastCheckAt: row.last_check_at === null ? null : Number(row.last_check_at),
      lastError: String(row.last_error ?? ""),
      jobCount: Number(row.job_count),
    };
  });
}

/** Motorun ihtiyaç duyduğu çözülmüş hâl — asla API yanıtına konmaz. */
export type RepoSecrets = {
  id: number;
  name: string;
  kind: RepoKind;
  location: string;
  password: string;
  env: Record<string, string>;
};

export function repoSecrets(id: number): RepoSecrets | null {
  const row = getDb()
    .prepare("SELECT id, name, kind, location, password_enc, env_enc FROM backup_repos WHERE id = ?")
    .get(id) as Record<string, string | number> | undefined;
  if (!row) return null;

  const password = readEncrypted(String(row.password_enc ?? ""));
  if (password === null) return null;

  const envRaw = readEncrypted(String(row.env_enc ?? "")) ?? "";
  const env: Record<string, string> = {};
  for (const line of envRaw.split("\n")) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    env[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }

  return {
    id: Number(row.id),
    name: String(row.name),
    kind: String(row.kind) as RepoKind,
    location: String(row.location),
    password,
    env,
  };
}

export type RepoInput = {
  name: string;
  kind: string;
  location: string;
  /** Boş bırakılırsa mevcut parola korunur (düzenlemede). */
  password: string;
  env: string;
};

export function validateRepo(input: RepoInput, isNew: boolean): string | null {
  if (input.name.trim().length < 2) return serverT("backupStore.repoName");
  if (!REPO_KINDS.has(input.kind as RepoKind)) return serverT("backupStore.repoKind");
  if (input.location.trim().length === 0) return serverT("backupStore.repoLocation");

  if (input.kind === "local") {
    const path = input.location.trim();
    if (!path.startsWith("/") || path.includes("..")) {
      return serverT("backupStore.localPath");
    }
    // Yedeği yedeklenen verinin yanına koymak, tek bir disk arızasında ikisini
    // birden kaybetmek demektir. Engellenmiyor ama en tehlikeli iki yer
    // doğrudan reddediliyor.
    if (path === "/" || path.startsWith("/proc") || path.startsWith("/sys")) {
      return serverT("backupStore.forbiddenRepo");
    }
  }

  if (isNew && input.password.length < 8) {
    return serverT("backupStore.repoPassword");
  }
  return null;
}

export function createRepo(input: RepoInput): number {
  const info = getDb()
    .prepare(
      `INSERT INTO backup_repos (name, kind, location, password_enc, env_enc)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      input.name.trim(),
      input.kind,
      input.location.trim(),
      JSON.stringify(encryptSecret(input.password)),
      input.env.trim() ? JSON.stringify(encryptSecret(input.env.trim())) : "",
    );
  return Number(info.lastInsertRowid);
}

export function updateRepo(id: number, input: RepoInput): boolean {
  const db = getDb();
  const changes = db
    .prepare("UPDATE backup_repos SET name = ?, kind = ?, location = ? WHERE id = ?")
    .run(input.name.trim(), input.kind, input.location.trim(), id).changes;

  // Parola yalnızca YENİ bir değer girildiyse değişir. Boş bırakmak "aynı
  // kalsın" demek; aksi halde her düzenleme parolayı silerdi.
  if (input.password.length > 0) {
    db.prepare("UPDATE backup_repos SET password_enc = ?, initialized = 0 WHERE id = ?").run(
      JSON.stringify(encryptSecret(input.password)),
      id,
    );
  }
  if (input.env.trim().length > 0) {
    db.prepare("UPDATE backup_repos SET env_enc = ? WHERE id = ?").run(
      JSON.stringify(encryptSecret(input.env.trim())),
      id,
    );
  }

  return Number(changes) > 0;
}

export function deleteRepo(id: number): { ok: boolean; error?: string } {
  const jobs = getDb()
    .prepare("SELECT COUNT(*) AS n FROM backup_jobs WHERE repo_id = ?")
    .get(id) as { n: number };
  if (Number(jobs.n) > 0) {
    return {
      ok: false,
      error: serverT("backupStore.repoInUse", { count: jobs.n }),
    };
  }
  // Depo KAYDI siliniyor, deponun kendisi değil: diskteki restic verisine
  // panel dokunmuyor. Yanlışlıkla silinen bir kayıt yeniden eklenebilir.
  getDb().prepare("DELETE FROM backup_repos WHERE id = ?").run(id);
  return { ok: true };
}

export function markRepoChecked(id: number, initialized: boolean, error: string): void {
  getDb()
    .prepare(
      "UPDATE backup_repos SET initialized = ?, last_check_at = unixepoch(), last_error = ? WHERE id = ?",
    )
    .run(initialized ? 1 : 0, error, id);
}

/* --- İşler --- */

export function listJobs(): BackupJob[] {
  return (
    getDb()
      .prepare(
        `SELECT j.*, r.name AS repo_name
         FROM backup_jobs j JOIN backup_repos r ON r.id = j.repo_id
         ORDER BY j.name COLLATE NOCASE`,
      )
      .all() as Record<string, string | number | null>[]
  ).map(toJob);
}

export function getJob(id: number): BackupJob | null {
  const row = getDb()
    .prepare(
      `SELECT j.*, r.name AS repo_name
       FROM backup_jobs j JOIN backup_repos r ON r.id = j.repo_id
       WHERE j.id = ?`,
    )
    .get(id) as Record<string, string | number | null> | undefined;
  return row ? toJob(row) : null;
}

function toJob(row: Record<string, string | number | null>): BackupJob {
  return {
    id: Number(row.id),
    name: String(row.name),
    repoId: Number(row.repo_id),
    repoName: String(row.repo_name),
    sourceKind: String(row.source_kind) as SourceKind,
    source: String(row.source),
    scheduleCron: String(row.schedule_cron),
    quiesce: String(row.quiesce),
    excludes: String(row.excludes),
    keepDaily: Number(row.keep_daily),
    keepWeekly: Number(row.keep_weekly),
    keepMonthly: Number(row.keep_monthly),
    enabled: Number(row.enabled) === 1,
    lastRunAt: row.last_run_at === null ? null : Number(row.last_run_at),
    lastStatus: String(row.last_status ?? ""),
  };
}

export type JobInput = {
  name: string;
  repoId: number;
  sourceKind: string;
  source: string;
  scheduleCron: string;
  quiesce: string;
  excludes: string;
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
  enabled: boolean;
};

export function validateJob(input: JobInput): string | null {
  if (input.name.trim().length < 2) return serverT("backupStore.jobName");
  if (!SOURCE_KINDS.has(input.sourceKind as SourceKind)) return serverT("backupStore.sourceKind");

  if (input.sourceKind === "host_dir") {
    const path = input.source.trim();
    if (!path.startsWith("/") || path.includes("..")) {
      return serverT("backupStore.hostPath");
    }
  }
  if (input.sourceKind === "volume" && input.source.trim().length === 0) {
    return serverT("backupStore.volumeRequired");
  }
  if (
    input.keepDaily < 0 ||
    input.keepWeekly < 0 ||
    input.keepMonthly < 0 ||
    input.keepDaily + input.keepWeekly + input.keepMonthly === 0
  ) {
    return serverT("backupStore.retention");
  }
  if (!getDb().prepare("SELECT id FROM backup_repos WHERE id = ?").get(input.repoId)) {
    return serverT("backupStore.repoMissing");
  }
  return null;
}

export function createJob(input: JobInput): number {
  const info = getDb()
    .prepare(
      `INSERT INTO backup_jobs
         (name, repo_id, source_kind, source, schedule_cron, quiesce, excludes,
          keep_daily, keep_weekly, keep_monthly, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.name.trim(),
      input.repoId,
      input.sourceKind,
      input.source.trim(),
      input.scheduleCron.trim(),
      input.quiesce.trim(),
      input.excludes.trim(),
      input.keepDaily,
      input.keepWeekly,
      input.keepMonthly,
      input.enabled ? 1 : 0,
    );
  return Number(info.lastInsertRowid);
}

export function updateJob(id: number, input: JobInput): boolean {
  return (
    Number(
      getDb()
        .prepare(
          `UPDATE backup_jobs
           SET name = ?, repo_id = ?, source_kind = ?, source = ?, schedule_cron = ?,
               quiesce = ?, excludes = ?, keep_daily = ?, keep_weekly = ?,
               keep_monthly = ?, enabled = ?
           WHERE id = ?`,
        )
        .run(
          input.name.trim(),
          input.repoId,
          input.sourceKind,
          input.source.trim(),
          input.scheduleCron.trim(),
          input.quiesce.trim(),
          input.excludes.trim(),
          input.keepDaily,
          input.keepWeekly,
          input.keepMonthly,
          input.enabled ? 1 : 0,
          id,
        ).changes,
    ) > 0
  );
}

export function deleteJob(id: number): boolean {
  return Number(getDb().prepare("DELETE FROM backup_jobs WHERE id = ?").run(id).changes) > 0;
}

/* --- Çalışma geçmişi --- */

export function startRun(jobId: number, actor: string): number {
  const info = getDb()
    .prepare("INSERT INTO backup_runs (job_id, actor) VALUES (?, ?)")
    .run(jobId, actor);
  return Number(info.lastInsertRowid);
}

export function finishRun(
  runId: number,
  jobId: number,
  outcome: {
    status: RunStatus;
    snapshotId?: string;
    filesNew?: number;
    filesChanged?: number;
    bytesAdded?: number;
    durationMs: number;
    pruned?: number;
    detail: string;
  },
): void {
  const db = getDb();
  db.prepare(
    `UPDATE backup_runs
     SET finished_at = unixepoch(), status = ?, snapshot_id = ?, files_new = ?,
         files_changed = ?, bytes_added = ?, duration_ms = ?, pruned = ?, detail = ?
     WHERE id = ?`,
  ).run(
    outcome.status,
    outcome.snapshotId ?? "",
    outcome.filesNew ?? 0,
    outcome.filesChanged ?? 0,
    outcome.bytesAdded ?? 0,
    outcome.durationMs,
    outcome.pruned ?? 0,
    outcome.detail.slice(0, 4000),
    runId,
  );

  db.prepare("UPDATE backup_jobs SET last_run_at = unixepoch(), last_status = ? WHERE id = ?").run(
    outcome.status,
    jobId,
  );
}

export function listRuns(limit = 50, jobId?: number): BackupRun[] {
  const clause = jobId === undefined ? "" : "WHERE r.job_id = ?";
  const params: number[] = jobId === undefined ? [] : [jobId];

  return (
    getDb()
      .prepare(
        `SELECT r.*, j.name AS job_name
         FROM backup_runs r JOIN backup_jobs j ON j.id = r.job_id
         ${clause} ORDER BY r.started_at DESC, r.id DESC LIMIT ?`,
      )
      .all(...params, limit) as Record<string, string | number | null>[]
  ).map((row) => ({
    id: Number(row.id),
    jobId: Number(row.job_id),
    jobName: String(row.job_name),
    startedAt: Number(row.started_at),
    finishedAt: row.finished_at === null ? null : Number(row.finished_at),
    status: String(row.status) as RunStatus,
    snapshotId: String(row.snapshot_id),
    filesNew: Number(row.files_new),
    filesChanged: Number(row.files_changed),
    bytesAdded: Number(row.bytes_added),
    durationMs: Number(row.duration_ms),
    pruned: Number(row.pruned),
    detail: String(row.detail ?? ""),
    actor: String(row.actor ?? ""),
  }));
}

/**
 * Faz 1'deki yedek takibi (M1.10) bu motorun çıktısını okuyor: en son BAŞARILI
 * çalışmanın zamanı. Hiç başarılı çalışma yoksa null.
 */
export function lastSuccessfulRunAt(): number | null {
  const row = getDb()
    .prepare("SELECT MAX(finished_at) AS ts FROM backup_runs WHERE status = 'ok'")
    .get() as { ts: number | null };
  return row.ts === null ? null : Number(row.ts);
}

export function dueJobs(): BackupJob[] {
  return listJobs().filter((job) => job.enabled && job.scheduleCron.trim().length > 0);
}
