import "server-only";

import { announce } from "@/lib/alerts/announce";
import { currentHostId, runWithHost } from "@/lib/hosts/context";
import { serverT } from "@/lib/i18n/runtime";
import { getDockerProvider } from "@/lib/providers";
import { getNumber } from "@/lib/settings";
import { finishLiveRun, isJobActive, registerRun, updateRun } from "./live";
import { repoKey, withRepoLock } from "./queue";
import {
  backupArgs,
  countRemoved,
  detectAnomaly,
  forgetArgs,
  looksLocked,
  looksUninitialized,
  parseResticLine,
  parseStats,
  type ResticSummary,
} from "./restic";
import { repoFreeSpace, resticRun, resticStream } from "./runner";
import { formatBytes, prepareSources, type Prepared } from "./sources";
import { discoverDocker } from "./discover";
import { addSource, getJob, setRetry } from "./store/jobs";
import { markRepoChecked, repoSecrets, saveRepoStats, type RepoSecrets } from "./store/repos";
import { finishRun, recentSuccessfulBackups, startRun } from "./store/runs";
import type { BackupJob, Category, LiveProgress, RunStatus } from "./types";

/**
 * Yedekleme akışı.
 *
 *   sıra (konum kilidi) → boş alan → depo hazır mı / otomatik oluştur →
 *   kaynakları hazırla (döküm, manifest) → container'ları durdur →
 *   restic backup (canlı) → container'ları başlat (HER DURUMDA) →
 *   saklama (forget --prune) → istatistik → anormal boyut → bildirim
 *
 * "Yedekle" isteği beklemez: koşu kimliği hemen döner, ilerleme SSE ile izlenir.
 */

export const RETRY_DELAY_SECONDS = 15 * 60;
export const MAX_ATTEMPTS = 3;
const LOW_SPACE_RATIO = 0.1;

/** Snapshot etiketi: işin kendi snapshot'larını ayırır; saklama yalnızca ona dokunur. */
export function tagFor(job: Pick<BackupJob, "id" | "category">, hostId = currentHostId()): string {
  return job.category === "custom" ? `panel-job-${job.id}` : `panel-${job.category}-h${hostId}`;
}

/**
 * restic `--host` değeri. Parent snapshot (değişmeyen dosyaları yeniden
 * okumama) host + yol eşleşmesiyle bulunuyor; v1 işleri adlarını kullanıyordu,
 * aynısı korunuyor.
 */
function resticHostFor(job: BackupJob, hostId: number): string {
  return job.category === "custom" ? job.name : `panel-h${hostId}-${job.category}`;
}

export type StartOutcome = { ok: true; runId: number } | { ok: false; error: string };

/** Yedeklemeyi başlatır ve hemen döner. */
export function startBackup(jobId: number, actor: string, attempt = 1): StartOutcome {
  const job = getJob(jobId);
  if (!job) return { ok: false, error: serverT("backupEngine.jobMissing") };
  if (isJobActive(job.id)) return { ok: false, error: serverT("backupEngine.alreadyRunning") };

  const secrets = repoSecrets(job.repoId);
  if (!secrets) return { ok: false, error: serverT("backupEngine.passwordUnreadable", { repo: job.repoName }) };

  const hostId = currentHostId();
  const runId = startRun(job.id, "backup", actor, attempt);
  const signal = registerRun(hostId, initialProgress(runId, job.id, job.category, "backup"));

  // Arka planda; sunucu bağlamı açıkça taşınıyor (istek bitince de geçerli).
  void runWithHost(hostId, () => executeBackup(job, secrets, runId, attempt, signal, hostId)).catch((error) => {
    console.error(`[backup] koşu ${runId} beklenmedik hata:`, error);
  });
  return { ok: true, runId };
}

/** Zamanlayıcı için: bitene kadar bekler. */
export async function runBackupAndWait(jobId: number, actor: string, attempt = 1): Promise<{ ok: boolean; detail: string }> {
  const started = startBackup(jobId, actor, attempt);
  if (!started.ok) return { ok: false, detail: started.error };
  return new Promise((resolve) => {
    waiters.set(started.runId, resolve);
  });
}

const waiters = new Map<number, (outcome: { ok: boolean; detail: string }) => void>();

export function initialProgress(runId: number, jobId: number, category: Category, kind: LiveProgress["kind"]): LiveProgress {
  return {
    runId,
    jobId,
    category,
    kind,
    phase: "queued",
    percent: null,
    filesDone: 0,
    totalFiles: 0,
    bytesDone: 0,
    totalBytes: 0,
    currentFiles: [],
    startedAt: Math.floor(Date.now() / 1000),
    secondsRemaining: null,
    message: "",
    done: false,
    status: "running",
  };
}

async function executeBackup(
  job: BackupJob,
  repo: RepoSecrets,
  runId: number,
  attempt: number,
  signal: AbortSignal,
  hostId: number,
): Promise<void> {
  const startedAt = Date.now();
  const notes: string[] = [];
  const warnings: string[] = [];
  const log: string[] = [];
  let prepared: Prepared | null = null;
  const stopped: string[] = [];
  let summary: ResticSummary | null = null;
  let status: Exclude<RunStatus, "running"> = "ok";
  let detail = "";
  let anomaly = "";
  let pruned = 0;

  const phase = (next: LiveProgress["phase"], message = "") => updateRun(runId, { phase: next, message });

  try {
    await withRepoLock(
      repoKey(hostId, repo.id),
      async () => {
        if (signal.aborted) throw new CancelledError();

        // 1. Boş alan.
        if (job.options.spaceCheck) {
          phase("preparing", serverT("backupEngine.phase.space"));
          const space = await repoFreeSpace(repo).catch(() => null);
          if (space && space.totalBytes > 0 && space.freeBytes / space.totalBytes < LOW_SPACE_RATIO) {
            const message = serverT("backupEngine.lowSpace", {
              free: formatBytes(space.freeBytes),
              total: formatBytes(space.totalBytes),
            });
            warnings.push(message);
            await announce({
              alertKey: `backup.space.${repo.id}`,
              source: "system",
              severity: "warning",
              title: serverT("backupEngine.lowSpaceTitle", { repo: repo.name }),
              detail: message,
            });
          }
        }

        // 2. Depo hazır mı? İlk çalıştırmada otomatik oluşturulur.
        phase("preparing", serverT("backupEngine.phase.repo"));
        if (await ensureRepository(repo)) notes.push(serverT("backupEngine.repoCreated"));

        // 3. Kaynaklar.
        const effective = await withAutoInclude(job);
        prepared = await prepareSources(effective, { onPhase: (next, message) => phase(next, message) });
        notes.push(...prepared.notes);
        warnings.push(...prepared.warnings);
        if (signal.aborted) throw new CancelledError();

        // 4. Container'ları durdur.
        const toStop = [
          ...prepared.stopContainers,
          ...job.quiesce.split("\n").map((name) => name.trim()).filter(Boolean),
        ];
        for (const name of toStop) {
          phase("stopping", serverT("backupEngine.phase.stopping", { name }));
          await getDockerProvider().action(name, "stop", getNumber("docker.stop_timeout"));
          stopped.push(name);
        }

        // 5. restic backup (canlı).
        phase("scanning", serverT("backupEngine.phase.scanning"));
        const result = await resticStream(
          repo,
          backupArgs({
            paths: prepared.paths,
            tags: [tagFor(job, hostId)],
            host: resticHostFor(job, hostId),
            excludes: prepared.excludes,
            limitUploadKb: repo.options.limitUploadKb,
          }),
          {
            binds: prepared.binds,
            lowPriority: job.options.lowPriority,
            namePrefix: "panel-restic-backup",
            signal,
            onLine: (line) => {
              const parsed = parseResticLine(line);
              if (parsed.type === "status") {
                const progress = parsed.progress;
                updateRun(runId, {
                  phase: progress.bytesDone > 0 || (progress.percent ?? 0) > 0 ? "uploading" : "scanning",
                  percent: progress.percent,
                  filesDone: progress.filesDone,
                  totalFiles: progress.totalFiles,
                  bytesDone: progress.bytesDone,
                  totalBytes: progress.totalBytes,
                  currentFiles: progress.currentFiles,
                  secondsRemaining: progress.secondsRemaining,
                });
              } else if (parsed.type === "summary") {
                summary = parsed.summary;
              } else if (parsed.type === "error") {
                log.push(`${parsed.item}: ${parsed.message}`);
              } else if (parsed.text) {
                log.push(parsed.text);
              }
            },
          },
        );
        log.push(...result.tail.filter((line) => !log.includes(line)).slice(-50));

        // 6. Container'ları geri başlat (yedek sonucundan bağımsız).
        await restartStopped(stopped, warnings, phase);

        if (result.cancelled) throw new CancelledError();
        if (result.timedOut) throw new Error(serverT("backupEngine.timedOut"));
        // 3 = "bazı dosyalar okunamadı": yedek ALINDI ama eksik.
        if (result.exitCode === 3) {
          status = "warning";
          warnings.push(serverT("backupEngine.partial"));
        } else if (result.exitCode !== 0) {
          const output = log.slice(-15).join("\n");
          if (looksLocked(output)) throw new Error(serverT("backupEngine.locked"));
          throw new Error(output.slice(-800) || serverT("backupEngine.resticExit", { code: result.exitCode }));
        }
        if (!summary) throw new Error(serverT("backupEngine.noSummary", { output: log.slice(-5).join("\n").slice(0, 500) }));

        // 7. Saklama.
        phase("pruning", serverT("backupEngine.phase.pruning"));
        const forget = await resticRun(
          repo,
          forgetArgs(tagFor(job, hostId), {
            last: job.keepLast,
            daily: job.keepDaily,
            weekly: job.keepWeekly,
            monthly: job.keepMonthly,
          }),
          { lowPriority: job.options.lowPriority, namePrefix: "panel-restic-forget" },
        );
        if (forget.exitCode !== 0) warnings.push(serverT("backupEngine.retentionFailed"));
        else {
          pruned = countRemoved(forget.output);
          if (pruned > 0) notes.push(serverT("backupEngine.pruned", { count: pruned }));
        }

        // 8. İstatistik (kart boyutları) — başarısızlığı yedeği bozmaz.
        phase("finishing", serverT("backupEngine.phase.finishing"));
        await refreshRepoStats(repo).catch(() => undefined);
      },
      () => phase("queued", serverT("backupEngine.phase.queued")),
    );

    // 9. Anormal boyut.
    const finalSummary = summary as ResticSummary | null;
    if (finalSummary && job.options.anomaly) {
      const history = recentSuccessfulBackups(job.id, 10);
      const found = detectAnomaly(finalSummary, history);
      if (found) {
        anomaly =
          found.kind === "growth"
            ? serverT("backupEngine.anomalyGrowth", { size: formatBytes(finalSummary.bytesAdded), ratio: found.ratio.toFixed(1) })
            : serverT("backupEngine.anomalyShrink", { percent: Math.round((1 - found.ratio) * 100) });
        status = "warning";
      }
    }

    detail = composeDetail(finalSummary, notes, warnings);
    finishRun(runId, {
      status,
      snapshotId: finalSummary?.snapshotId,
      filesNew: finalSummary?.filesNew,
      filesChanged: finalSummary?.filesChanged,
      filesTotal: finalSummary?.filesTotal,
      bytesAdded: finalSummary?.bytesAdded,
      bytesProcessed: finalSummary?.bytesProcessed,
      durationMs: Date.now() - startedAt,
      pruned,
      detail,
      anomaly,
      log: log.join("\n"),
    });
    setRetry(job.id, null, 0);
    finishLiveRun(runId, { status, message: detail, percent: 100 });

    if (anomaly) {
      await announce({
        alertKey: `backup.anomaly.${job.id}`,
        source: "system",
        severity: "warning",
        title: serverT("backupEngine.anomalyTitle", { name: jobLabel(job) }),
        detail: anomaly,
      });
    }
    if (job.notifySuccess) {
      await announce({
        alertKey: `backup.ok.${job.id}`,
        source: "system",
        severity: "info",
        title: serverT("backupEngine.successTitle", { name: jobLabel(job) }),
        detail,
      });
    }
    resolveWaiter(runId, { ok: true, detail });
  } catch (error) {
    await restartStopped(stopped, warnings, phase);
    const cancelled = error instanceof CancelledError;
    status = cancelled ? "cancelled" : "error";
    detail = cancelled
      ? serverT("backupEngine.cancelled")
      : `${describe(error)}${warnings.length > 0 ? ` · ${warnings.join(" · ")}` : ""}`;
    finishRun(runId, { status, durationMs: Date.now() - startedAt, detail, log: log.join("\n") });
    finishLiveRun(runId, { status, message: detail });

    // Yeniden deneme: iptal edilmediyse, ayar açıksa ve hak kaldıysa.
    const willRetry = !cancelled && job.options.retry && attempt < MAX_ATTEMPTS;
    if (willRetry) {
      setRetry(job.id, Math.floor(Date.now() / 1000) + RETRY_DELAY_SECONDS, attempt);
    } else {
      setRetry(job.id, null, 0);
    }
    if (!cancelled && !willRetry) {
      await announce({
        alertKey: `backup.failed.${job.id}`,
        source: "system",
        severity: "critical",
        title: serverT("backupEngine.failedTitle", { name: jobLabel(job) }),
        detail: attempt > 1 ? `${detail} · ${serverT("backupEngine.afterAttempts", { count: attempt })}` : detail,
      });
    }
    resolveWaiter(runId, { ok: false, detail });
  } finally {
    const done = prepared as Prepared | null;
    if (done) await done.cleanup();
  }
}

class CancelledError extends Error {}

/**
 * "Yeni container'ları otomatik dahil et": iş kurulduktan sonra eklenen
 * container'lar kaynak listesine yazılır (panelin kendisi hariç).
 */
async function withAutoInclude(job: BackupJob): Promise<BackupJob> {
  if (job.category !== "docker" || !job.options.autoInclude) return job;
  const known = new Set(job.sources.filter((source) => source.kind === "container").map((source) => source.ref));
  let added = false;
  for (const item of await discoverDocker()) {
    if (known.has(item.name) || !item.selected) continue;
    addSource(job.id, { kind: "container", ref: item.name, enabled: true, options: { stop: false } });
    added = true;
  }
  return added ? (getJob(job.id) ?? job) : job;
}

function resolveWaiter(runId: number, outcome: { ok: boolean; detail: string }): void {
  const waiter = waiters.get(runId);
  if (waiter) {
    waiters.delete(runId);
    waiter(outcome);
  }
}

async function restartStopped(
  stopped: string[],
  warnings: string[],
  phase: (next: LiveProgress["phase"], message?: string) => void,
): Promise<void> {
  while (stopped.length > 0) {
    const name = stopped.shift() as string;
    phase("starting", serverT("backupEngine.phase.starting", { name }));
    try {
      await getDockerProvider().action(name, "start", 0);
    } catch (error) {
      warnings.push(serverT("backupEngine.restartFailed", { name, error: describe(error) }));
    }
  }
}

/**
 * Depo yoksa oluşturur. `true` = bu çağrıda oluşturuldu. Kilit hatası ya da
 * erişim sorunu açıklamalı hata olarak fırlatılır.
 */
export async function ensureRepository(repo: RepoSecrets): Promise<boolean> {
  const check = await resticRun(repo, ["cat", "config"], { namePrefix: "panel-restic-check" });
  if (check.exitCode === 0) {
    markRepoChecked(repo.id, true, "");
    return false;
  }
  if (!looksUninitialized(check.output, check.exitCode)) {
    const message = check.output.trim().slice(0, 500) || serverT("backupEngine.resticExit", { code: check.exitCode });
    markRepoChecked(repo.id, false, message);
    throw new Error(message);
  }
  const created = await resticRun(repo, ["init"], { namePrefix: "panel-restic-init" });
  if (created.exitCode !== 0) {
    const message = created.output.trim().slice(0, 500);
    markRepoChecked(repo.id, false, message);
    throw new Error(serverT("backupEngine.initFailed", { message }));
  }
  markRepoChecked(repo.id, true, "");
  return true;
}

/** Konum kartındaki boyut/snapshot sayısı/boş alan. */
export async function refreshRepoStats(repo: RepoSecrets): Promise<void> {
  const result = await resticRun(repo, ["stats", "--mode", "raw-data", "--json"], { namePrefix: "panel-restic-stats" });
  const stats = result.exitCode === 0 ? parseStats(result.output) : null;
  if (!stats) return;
  const space = await repoFreeSpace(repo).catch(() => null);
  saveRepoStats(repo.id, {
    ...stats,
    freeBytes: space?.freeBytes ?? null,
    totalBytes: space?.totalBytes ?? null,
  });
}

export function jobLabel(job: Pick<BackupJob, "category" | "name">): string {
  return job.category === "custom" ? job.name : serverT(`backup.category.${job.category}`);
}

function composeDetail(summary: ResticSummary | null, notes: string[], warnings: string[]): string {
  const parts: string[] = [];
  if (summary) {
    parts.push(
      serverT("backupEngine.summary", {
        new: summary.filesNew,
        changed: summary.filesChanged,
        size: formatBytes(summary.bytesAdded),
      }),
    );
  }
  parts.push(...notes, ...warnings);
  return parts.join(" · ");
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export { formatBytes };
