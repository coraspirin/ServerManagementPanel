import "server-only";

import { CronExpressionParser } from "cron-parser";

import { serverT } from "@/lib/i18n/runtime";
import { MAX_ATTEMPTS, runBackupAndWait } from "./engine";
import { activeRunIds, isJobActive } from "./live";
import { listJobs } from "./store/jobs";
import { listRepos } from "./store/repos";
import { closeOrphanRuns } from "./store/runs";
import { verifyRepo } from "./verify";
import type { BackupJob, BackupRepo } from "./types";

/**
 * Zamanlanmış tur (perHost `backup.scheduler` işi, varsayılan 10 dk'da bir).
 *
 * İşler panel iş kayıtçısına tek tek kaydedilmiyor: o kayıt STATİK ve kullanıcı
 * çalışma zamanında iş tanımlayabiliyor. Bunun yerine bu tur vadesi geleni
 * buluyor: zamanlanmış yedekler, yeniden denemeler ve konum doğrulamaları.
 */

/**
 * Cron ifadeleri panelin saat diliminde okunur (`general.timezone`, açılışta
 * ve ayar değişince `process.env.TZ`'ye yazılıyor — `lib/time/zone.ts`).
 * Açıkça veriliyor ki süreç dilimi bir şekilde boş kalırsa sessizce UTC'ye
 * düşülmesin (2026-10-14'e kadar böyleydi: "0 6 * * *" TR 09:00'da çalıştı).
 */
function cronOptions(from: Date, tz = process.env.TZ): { currentDate: Date; tz?: string } {
  return tz ? { currentDate: from, tz } : { currentDate: from };
}

/** Cron ifadesine göre `from`dan sonraki ilk çalışma (unix sn); bozuksa null. */
export function nextRunAt(cron: string, from: Date, tz?: string): number | null {
  if (cron.trim().length === 0) return null;
  try {
    return Math.floor(CronExpressionParser.parse(cron, cronOptions(from, tz)).next().getTime() / 1000);
  } catch {
    return null;
  }
}

/** Sonraki N çalışma — arayüz önizlemesi. */
export function upcomingRuns(cron: string, count = 3, from = new Date(), tz?: string): number[] {
  const result: number[] = [];
  try {
    const interval = CronExpressionParser.parse(cron, cronOptions(from, tz));
    for (let index = 0; index < count; index += 1) result.push(Math.floor(interval.next().getTime() / 1000));
  } catch {
    // Bozuk ifade: önizleme boş.
  }
  return result;
}

export function isDue(job: Pick<BackupJob, "enabled" | "scheduleCron" | "lastRunAt">, now = new Date()): boolean {
  if (!job.enabled || job.scheduleCron.trim().length === 0) return false;
  // Hiç çalışmamışsa ilk turda çalışsın: ilk yedeğin bir sonraki gece
  // yarısını beklemesi kafa karıştırıcı olurdu.
  if (job.lastRunAt === null) return true;
  const next = nextRunAt(job.scheduleCron, new Date(job.lastRunAt * 1000));
  return next !== null && next * 1000 <= now.getTime();
}

export function retryDue(job: Pick<BackupJob, "enabled" | "retryAt">, now = new Date()): boolean {
  return job.enabled && job.retryAt !== null && job.retryAt * 1000 <= now.getTime();
}

export function verifyDue(repo: Pick<BackupRepo, "verifyCron" | "lastVerifyAt" | "jobCount" | "initialized">, now = new Date()): boolean {
  if (!repo.initialized || repo.jobCount === 0 || repo.verifyCron.trim().length === 0) return false;
  // Hiç doğrulanmadıysa kurulumdan hemen sonra değil, takvimdeki ilk vakitte
  // (tur aralığı kadar geriye bakılıyor ki vakit kaçmasın).
  const from =
    repo.lastVerifyAt !== null ? new Date(repo.lastVerifyAt * 1000) : new Date(now.getTime() - 15 * 60_000);
  const next = nextRunAt(repo.verifyCron, from);
  return next !== null && next * 1000 <= now.getTime();
}

/** Beklenen aralığın 2 katı boyunca başarılı yedek yoksa "gecikti". */
export function overdueAfterSeconds(cron: string, from = new Date()): number | null {
  const [first, second] = upcomingRuns(cron, 2, from);
  if (first === undefined || second === undefined) return null;
  return (second - first) * 2;
}

export async function runDueBackups(): Promise<string> {
  // Panel yeniden başladıysa yarıda kalan koşular "running" asılı kalmasın.
  closeOrphanRuns(activeRunIds(), serverT("backupEngine.interrupted"));

  const now = new Date();
  const parts: string[] = [];
  const actor = serverT("backupEngine.scheduledActor");

  for (const job of listJobs()) {
    if (isJobActive(job.id)) continue;
    if (retryDue(job, now)) {
      // Sırayla: iki restic işi aynı depoya paralel yazmaz (kuyruk zaten bekletir).
      const attempt = Math.min(job.attempt + 1, MAX_ATTEMPTS);
      const outcome = await runBackupAndWait(job.id, serverT("backupEngine.retryActor", { attempt }), attempt);
      parts.push(`${job.name}: ${outcome.ok ? "ok" : serverT("backupEngine.error")} (${attempt})`);
    } else if (isDue(job, now)) {
      const outcome = await runBackupAndWait(job.id, actor);
      parts.push(`${job.name}: ${outcome.ok ? "ok" : serverT("backupEngine.error")}`);
    }
  }

  for (const repo of listRepos()) {
    if (!verifyDue(repo, now)) continue;
    const outcome = await verifyRepo(repo.id, actor);
    parts.push(`${repo.name}: ${serverT("backupVerify.label")} ${outcome.ok ? "ok" : serverT("backupEngine.error")}`);
  }

  return parts.length > 0 ? parts.join(" · ") : serverT("backupEngine.nothingDue");
}
