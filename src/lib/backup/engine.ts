import "server-only";

import { rmSync, statSync } from "node:fs";
import path from "node:path";

import { CronExpressionParser } from "cron-parser";

import { announce } from "@/lib/alerts/announce";
import { dataDir, getDb } from "@/lib/db/client";
import { currentHostId, LOCAL_HOST_ID } from "@/lib/hosts/context";
import { panelDataVolume } from "@/lib/host/self";
import { serverT } from "@/lib/i18n/runtime";
import { getDockerProvider } from "@/lib/providers";
import { getNumber } from "@/lib/settings";
import {
  finishRun,
  getJob,
  listJobs,
  markRepoChecked,
  repoSecrets,
  startRun,
} from "./store";
import { checkRepo, initRepo, runForget, runResticBackup, type BackupTarget } from "./restic";
import type { BackupJob } from "./types";

/**
 * M3.4 — yedekleme motoru.
 *
 * Bir işin akışı: (1) gerekiyorsa container'ı durdur, (2) kaynağa göre hazırlık
 * yap, (3) restic backup, (4) container'ı geri başlat, (5) retention uygula.
 *
 * Container'ı geri BAŞLATMAK, yedeğin başarılı olup olmamasından bağımsız:
 * yedekleme başarısız diye Home Assistant'ı kapalı bırakmak, çözmeye çalıştığı
 * sorundan çok daha büyük bir sorun olurdu.
 */

const PANEL_SNAPSHOT_NAME = "panel-db-snapshot.db";

/**
 * Panel veritabanının tutarlı kopyası. Canlı dosyayı kopyalamak WAL yüzünden
 * yarım bir veritabanı üretir; `VACUUM INTO` her zaman açılabilir tek dosya
 * yazar.
 */
function vacuumPanelDb(): { file: string; bytes: number } {
  const target = path.join(dataDir(), "backups", PANEL_SNAPSHOT_NAME);

  // VACUUM INTO var olan dosyanın üzerine YAZMAZ, hata verir; önceki kopya
  // silinmeli.
  rmSync(target, { force: true });
  getDb().prepare("VACUUM INTO ?").run(target);

  return { file: target, bytes: statSync(target).size };
}

/**
 * Panel volume'ü yedeklenirken CANLI veritabanı dosyaları dışarıda bırakılıyor:
 * onların tutarlı kopyası zaten `panel-db-snapshot.db` olarak yanlarında
 * duruyor. Migration öncesi kopyalar da atlanıyor — onlar geçici.
 */
const PANEL_DB_EXCLUDES = [
  "/data/panel.db",
  "/data/panel.db-wal",
  "/data/panel.db-shm",
  "/data/backups/pre-migration-*.db",
];

export type RunOutcome = {
  ok: boolean;
  runId: number;
  detail: string;
  snapshotId: string;
  bytesAdded: number;
};

export async function runBackupJob(jobId: number, actor: string): Promise<RunOutcome> {
  const job = getJob(jobId);
  if (!job) {
    return {
      ok: false,
      runId: 0,
      detail: serverT("backupEngine.jobMissing"),
      snapshotId: "",
      bytesAdded: 0,
    };
  }

  const secrets = repoSecrets(job.repoId);
  if (!secrets) {
    return {
      ok: false,
      runId: 0,
      detail: serverT("backupEngine.passwordUnreadable", { repo: job.repoName }),
      snapshotId: "",
      bytesAdded: 0,
    };
  }

  const runId = startRun(job.id, actor);
  const startedAt = Date.now();
  const notes: string[] = [];
  let quiesced = false;

  try {
    // Depo hazır mı? İlk çalıştırmada otomatik oluşturuluyor — kullanıcıyı
    // "init" diye ayrı bir adıma zorlamak, unutulduğunda anlaşılmaz bir
    // hataya dönüşürdü.
    const check = await checkRepo(secrets);
    if (!check.ok && !check.initialized) {
      const created = await initRepo(secrets);
      markRepoChecked(secrets.id, created.initialized, created.ok ? "" : created.message);
      if (!created.ok) {
        throw new Error(serverT("backupEngine.initFailed", { message: created.message }));
      }
      notes.push(serverT("backupEngine.repoCreated"));
    } else if (!check.ok) {
      markRepoChecked(secrets.id, check.initialized, check.message);
      throw new Error(check.message);
    } else {
      markRepoChecked(secrets.id, true, "");
    }

    let target: BackupTarget;
    const excludes = job.excludes.split("\n").filter((entry) => entry.trim().length > 0);

    if (job.sourceKind === "panel_db") {
      // Panel veritabanı merkezde: uzak sunucudaki restic ona erişemez.
      if (currentHostId() !== LOCAL_HOST_ID) {
        throw new Error(serverT("backupEngine.panelDbLocalOnly"));
      }
      const volume = await panelDataVolume();
      if (!volume) {
        throw new Error(serverT("backupEngine.noPanelVolume"));
      }
      const snapshot = vacuumPanelDb();
      notes.push(serverT("backupEngine.dbCopy", { size: formatBytes(snapshot.bytes) }));
      excludes.push(...PANEL_DB_EXCLUDES);
      target = { kind: "volume", name: volume };
    } else if (job.sourceKind === "volume") {
      target = { kind: "volume", name: job.source };
    } else {
      target = { kind: "path", hostPath: job.source };
    }

    if (job.quiesce.trim().length > 0) {
      await stopContainer(job.quiesce.trim());
      quiesced = true;
      notes.push(`${job.quiesce.trim()} durduruldu`);
    }

    const { result, summary } = await runResticBackup(secrets, target, {
      tag: tagFor(job),
      excludes,
      hostname: job.name,
    });

    if (quiesced) {
      await startContainer(job.quiesce.trim());
      quiesced = false;
    }

    // restic "some files could not be read" durumunda 3 döner: yedek ALINDI
    // ama eksik. Bunu tam başarısızlık saymak, her açık dosyada yedeği
    // çöpe atmak olurdu.
    const partial = result.exitCode === 3;
    if (result.exitCode !== 0 && !partial) {
      throw new Error(
        result.output.slice(0, 800) ||
          serverT("backupEngine.resticExit", { code: result.exitCode }),
      );
    }
    if (partial) notes.push(serverT("backupEngine.partial"));

    if (!summary) {
      throw new Error(serverT("backupEngine.noSummary", { output: result.output.slice(0, 500) }));
    }

    const forget = await runForget(secrets, tagFor(job), {
      daily: job.keepDaily,
      weekly: job.keepWeekly,
      monthly: job.keepMonthly,
    });
    if (!forget.ok) notes.push(serverT("backupEngine.retentionFailed"));
    else if (forget.removed > 0) {
      notes.push(serverT("backupEngine.pruned", { count: forget.removed }));
    }

    const detail =
      serverT("backupEngine.summary", {
        new: summary.filesNew,
        changed: summary.filesChanged,
        size: formatBytes(summary.bytesAdded),
      }) +
      (notes.length > 0 ? ` · ${notes.join(" · ")}` : "");

    finishRun(runId, job.id, {
      status: "ok",
      snapshotId: summary.snapshotId,
      filesNew: summary.filesNew,
      filesChanged: summary.filesChanged,
      bytesAdded: summary.bytesAdded,
      durationMs: Date.now() - startedAt,
      pruned: forget.removed,
      detail,
    });

    return {
      ok: true,
      runId,
      detail,
      snapshotId: summary.snapshotId,
      bytesAdded: summary.bytesAdded,
    };
  } catch (error) {
    // Durdurulmuş container her hâlükârda geri açılmalı.
    if (quiesced) {
      try {
        await startContainer(job.quiesce.trim());
      } catch (restartError) {
        notes.push(
          serverT("backupEngine.restartFailed", {
            name: job.quiesce.trim(),
            error: describe(restartError),
          }),
        );
      }
    }

    const detail = describe(error) + (notes.length > 0 ? ` · ${notes.join(" · ")}` : "");
    finishRun(runId, job.id, {
      status: "error",
      durationMs: Date.now() - startedAt,
      detail,
    });

    await announce({
      alertKey: `backup.failed.${job.id}`,
      source: "system",
      severity: "critical",
      title: serverT("backupEngine.failedTitle", { name: job.name }),
      detail,
    });

    return { ok: false, runId, detail, snapshotId: "", bytesAdded: 0 };
  }
}

/** Snapshot etiketi: iş kimliğini taşıyor ki retention yalnızca kendi işine dokunsun. */
export function tagFor(job: BackupJob): string {
  return `panel-job-${job.id}`;
}

async function stopContainer(name: string): Promise<void> {
  // Ayar anahtarı `docker.stop_timeout` — şemada bu adla tanımlı. Burada bir
  // süre `docker.stop_timeout_seconds` yazıyordu ve `getNumber` tanımsız ayar
  // için hata fırlattığı için quiesce (yedek öncesi container durdurma) yolu
  // her seferinde patlıyordu. Yedeklemeler quiesce'siz doğrulandığı için
  // M3.11'e kadar görünmedi.
  await getDockerProvider().action(name, "stop", getNumber("docker.stop_timeout"));
}

async function startContainer(name: string): Promise<void> {
  await getDockerProvider().action(name, "start", 0);
}

/**
 * Bir işin vadesi geldi mi?
 *
 * Kendi cron'u var ama panel iş kayıtçısına (M0.6) kaydedilmiyorlar: o kayıt
 * STATİK bir dizi ve kullanıcı çalışma zamanında yeni iş tanımlayabiliyor.
 * Bunun yerine tek bir "zamanlayıcı" işi periyodik koşup burayı soruyor.
 */
export function isDue(job: BackupJob, now = new Date()): boolean {
  if (!job.enabled || job.scheduleCron.trim().length === 0) return false;

  // Hiç çalışmamışsa ilk turda çalışsın: kullanıcı işi tanımladıktan sonra
  // ilk yedeğin bir sonraki gece yarısını beklemesi kafa karıştırıcı olurdu.
  if (job.lastRunAt === null) return true;

  try {
    const interval = CronExpressionParser.parse(job.scheduleCron, {
      currentDate: new Date(job.lastRunAt * 1000),
    });
    return interval.next().getTime() <= now.getTime();
  } catch {
    // Bozuk ifade sessizce sürekli çalışmaya dönüşmemeli.
    console.error(`[backup] "${job.name}" zamanlaması okunamadı: ${job.scheduleCron}`);
    return false;
  }
}

/** Zamanlanmış tur: vadesi gelen işleri sırayla çalıştırır. */
export async function runDueBackups(): Promise<string> {
  const jobs = listJobs().filter((job) => isDue(job));
  if (jobs.length === 0) return serverT("backupEngine.nothingDue");

  const parts: string[] = [];
  for (const job of jobs) {
    // Sırayla: iki restic işi aynı depoya paralel yazarsa depo kilidi
    // yüzünden biri başarısız olur.
    const outcome = await runBackupJob(job.id, serverT("backupEngine.scheduledActor"));
    parts.push(`${job.name}: ${outcome.ok ? "ok" : serverT("backupEngine.error")}`);
  }
  return parts.join(" · ");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[index]}`;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
