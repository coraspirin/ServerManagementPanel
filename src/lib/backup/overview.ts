import "server-only";

import { getDb } from "@/lib/db/client";
import { currentHostId } from "@/lib/hosts/context";
import { isJobActive, liveRuns } from "./live";
import { nextRunAt, overdueAfterSeconds } from "./scheduler";
import { listJobs } from "./store/jobs";
import { listRepos } from "./store/repos";
import { lastSuccessAt, successRate } from "./store/runs";
import {
  SYSTEM_CATEGORIES,
  type BackupJob,
  type BackupRepo,
  type Category,
  type LiveProgress,
  type SystemCategory,
} from "./types";

/**
 * Yedekleme durumu özeti — tek doğru kaynak: Yedekleme sayfası, ana sayfa
 * bileşeni, bakım kartı ve alarmlar aynı hesabı kullanır.
 */

export type SystemState = "ok" | "warning" | "error" | "off" | "running" | "unset";

export type SystemStatus = {
  category: Category;
  jobId: number | null;
  name: string;
  configured: boolean;
  enabled: boolean;
  state: SystemState;
  repoId: number | null;
  repoName: string;
  scheduleCron: string;
  lastRunAt: number | null;
  lastStatus: string;
  lastSuccessAt: number | null;
  nextRunAt: number | null;
  retryAt: number | null;
  /** Beklenen aralığın 2 katı boyunca başarılı yedek yok. */
  overdue: boolean;
  /** Seçili kaynak sayısı. */
  itemCount: number;
  /** Son başarılı yedekte işlenen toplam boyut. */
  lastSize: number | null;
  lastDetail: string;
  lastAnomaly: string;
};

type LastRun = { status: string; detail: string; anomaly: string; bytes_processed: number };

function lastRunOf(jobId: number): LastRun | null {
  return (
    (getDb()
      .prepare(
        `SELECT status, detail, anomaly, bytes_processed FROM backup_runs
         WHERE job_id = ? AND kind = 'backup' AND status <> 'running'
         ORDER BY started_at DESC, id DESC LIMIT 1`,
      )
      .get(jobId) as LastRun | undefined) ?? null
  );
}

function lastSizeOf(jobId: number): number | null {
  const row = getDb()
    .prepare(
      `SELECT bytes_processed FROM backup_runs
       WHERE job_id = ? AND kind = 'backup' AND status IN ('ok','warning')
       ORDER BY started_at DESC LIMIT 1`,
    )
    .get(jobId) as { bytes_processed: number } | undefined;
  return row ? Number(row.bytes_processed) : null;
}

export function statusOf(job: BackupJob, now = new Date()): SystemStatus {
  const success = lastSuccessAt(job.id);
  const last = lastRunOf(job.id);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const window = job.scheduleCron ? overdueAfterSeconds(job.scheduleCron, now) : null;
  // "Gecikti": zamanlanmış, etkin ve son başarılı yedek beklenen aralığın 2
  // katından eski (ya da hiç yok ve iş o kadar süredir var).
  const overdue =
    job.enabled &&
    window !== null &&
    (success === null ? (job.lastRunAt !== null && nowSeconds - job.lastRunAt > window) : nowSeconds - success > window);

  let state: SystemState;
  if (isJobActive(job.id)) state = "running";
  else if (!job.enabled) state = "off";
  else if (last?.status === "error" || overdue) state = "error";
  // Uyarılı yedek ya da henüz hiç yedek yok → sarı.
  else if (last === null || last.status === "warning" || last.status === "cancelled") state = "warning";
  else state = "ok";

  return {
    category: job.category,
    jobId: job.id,
    name: job.name,
    configured: true,
    enabled: job.enabled,
    state,
    repoId: job.repoId,
    repoName: job.repoName,
    scheduleCron: job.scheduleCron,
    lastRunAt: job.lastRunAt,
    lastStatus: job.lastStatus,
    lastSuccessAt: success,
    nextRunAt: job.enabled ? (job.retryAt ?? nextRunAt(job.scheduleCron, now)) : null,
    retryAt: job.retryAt,
    overdue,
    itemCount: job.sources.filter((source) => source.enabled).length,
    lastSize: lastSizeOf(job.id),
    lastDetail: last?.detail ?? "",
    lastAnomaly: last?.anomaly ?? "",
  };
}

function unset(category: SystemCategory): SystemStatus {
  return {
    category,
    jobId: null,
    name: category,
    configured: false,
    enabled: false,
    state: "unset",
    repoId: null,
    repoName: "",
    scheduleCron: "",
    lastRunAt: null,
    lastStatus: "",
    lastSuccessAt: null,
    nextRunAt: null,
    retryAt: null,
    overdue: false,
    itemCount: 0,
    lastSize: null,
    lastDetail: "",
    lastAnomaly: "",
  };
}

export type BackupOverview = {
  systems: SystemStatus[];
  custom: SystemStatus[];
  /** Özel işlerin tam kaydı (düzenleme formu için). */
  customJobs: BackupJob[];
  repos: BackupRepo[];
  live: LiveProgress[];
  rate: { ok: number; failed: number };
  /** Son 30 gün, gün başına eklenen veri (bayt) — grafik. */
  daily: { day: number; bytes: number; failed: number }[];
};

export function backupOverview(now = new Date()): BackupOverview {
  const jobs = listJobs();
  const systems = SYSTEM_CATEGORIES.map((category) => {
    const job = jobs.find((entry) => entry.category === category);
    return job ? statusOf(job, now) : unset(category);
  });
  const custom = jobs.filter((job) => job.category === "custom").map((job) => statusOf(job, now));
  const since = Math.floor(now.getTime() / 1000) - 30 * 86_400;

  const daily = (
    getDb()
      .prepare(
        `SELECT (started_at / 86400) * 86400 AS day,
                SUM(CASE WHEN status IN ('ok','warning') THEN bytes_added ELSE 0 END) AS bytes,
                SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS failed
         FROM backup_runs WHERE kind = 'backup' AND host_id = ? AND started_at >= ?
         GROUP BY day ORDER BY day`,
      )
      .all(currentHostId(), since) as { day: number; bytes: number; failed: number }[]
  ).map((row) => ({ day: Number(row.day), bytes: Number(row.bytes ?? 0), failed: Number(row.failed ?? 0) }));

  return {
    systems,
    custom,
    customJobs: jobs.filter((job) => job.category === "custom"),
    repos: listRepos(),
    live: liveRuns(currentHostId()),
    rate: successRate(since),
    daily,
  };
}

/** Ana sayfa/bakım için: yapılandırılmış sistemlerden kötü durumda olan var mı? */
export function backupHealth(): { configured: number; failing: SystemStatus[]; lastSuccessAt: number | null } {
  const jobs = listJobs();
  const statuses = jobs.map((job) => statusOf(job));
  const successes = statuses.map((status) => status.lastSuccessAt).filter((value): value is number => value !== null);
  return {
    configured: statuses.filter((status) => status.enabled).length,
    failing: statuses.filter((status) => status.state === "error"),
    lastSuccessAt: successes.length > 0 ? Math.max(...successes) : null,
  };
}
