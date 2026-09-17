import { randomUUID } from "node:crypto";
import { CronExpressionParser } from "cron-parser";
import { getDb } from "@/lib/db/client";
import { getString } from "@/lib/settings";
import {
  currentLocale,
  getDictionary,
  serverT,
  translator,
} from "@/lib/i18n/runtime";
import { jobText } from "@/lib/i18n/lookup";
import { findJob, jobDefinitions } from "./definitions";
import type { JobDefinition, JobStatusRow } from "./types";

/**
 * T2 — arka plan job runner.
 *
 * PLANDAN SAPMA (bilinçli): plan ayrı bir worker process öngörüyordu. Ancak
 * Next standalone çıktısı yalnızca uygulamayı paketliyor; ayrı bir TS worker'ı
 * aynı imajda çalıştırmak için lib kodunu ikinci kez derlemek ya da paylaşılan
 * modüllerden `server-only`'i sökmek gerekiyordu — ikisi de kırılgan.
 *
 * Bunun yerine zamanlayıcı uygulama process'i içinde çalışıyor. Planın asıl
 * gerekçesi ("Next.js API route'larında güvenilir zamanlanmış iş çalışmaz")
 * korunuyor: işler route handler'da değil, açılışta bir kez kurulan bağımsız
 * zamanlayıcıda. Kira tabanlı `job_locks` da yerinde — ileride worker ayrı
 * process'e taşındığında ya da dağıtım sırasında iki container örtüştüğünde
 * aynı iş iki kez çalışmaz.
 */

const OWNER = `${process.pid}-${randomUUID().slice(0, 8)}`;

/**
 * Tik aralığı, en sık çalışan işin çözünürlüğünü belirler. Metrik toplama
 * 5 saniyede bir çalıştığı için 1 saniye gerekiyor; tik başına maliyet tek bir
 * küçük SELECT olduğundan bu ihmal edilebilir.
 */
const TICK_MS = 1_000;

let timer: NodeJS.Timeout | null = null;

/**
 * Bu process içinde çalışmakta olan işler. `job_locks` zaten çift çalışmayı
 * engelliyor ama bu, 1 saniyelik tikin uzun süren bir işi her turda yeniden
 * denemesini ve boşuna kilit sorgusu atmasını önler.
 */
const running = new Set<string>();

/** Her tanım için `jobs` satırının var olduğundan emin olur. */
export function ensureJobRows(): void {
  const insert = getDb().prepare("INSERT OR IGNORE INTO jobs (key) VALUES (?)");
  for (const job of jobDefinitions) insert.run(job.key);
}

/** Zamanlama ayarını okuyup bir sonraki çalışma anını hesaplar. */
function computeNextRun(job: JobDefinition, from: Date = new Date()): number | null {
  try {
    if (job.schedule.kind === "fixed") {
      const seconds = job.schedule.seconds;
      const nowSeconds = Math.floor(from.getTime() / 1000);
      return (Math.floor(nowSeconds / seconds) + 1) * seconds;
    }

    if (job.schedule.kind === "interval") {
      const seconds = Number(getString(job.schedule.settingKey));
      if (!Number.isFinite(seconds) || seconds <= 0) return null;
      // Duvar saatine hizala: 5 sn'lik toplama :00, :05, :10 anlarına düşer.
      // Aksi halde her tur işin süresi kadar kayar ve zaman serisi düzensizleşir.
      const nowSeconds = Math.floor(from.getTime() / 1000);
      return (Math.floor(nowSeconds / seconds) + 1) * seconds;
    }
    const expression = getString(job.schedule.settingKey);
    const interval = CronExpressionParser.parse(expression, { currentDate: from });
    return Math.floor(interval.next().getTime() / 1000);
  } catch (error) {
    console.error(`[jobs] ${job.key} zamanlaması okunamadı:`, error);
    return null;
  }
}

export function scheduleText(job: JobDefinition): string {
  if (job.schedule.kind === "fixed") return translator(currentLocale())(job.schedule.labelKey as never);
  try {
    const value = getString(job.schedule.settingKey);
    return job.schedule.kind === "interval"
      ? serverT("jobs.screen.everySeconds", { value })
      : value;
  } catch {
    return "?";
  }
}

/**
 * Ayar değişince ilgili işi yeniden zamanlar (T9 `onChange` karşılığı).
 * Ayar anahtarı verilirse yalnızca o ayara bağlı işler güncellenir.
 */
export function rescheduleJobs(changedSettingKey?: string): void {
  const db = getDb();
  for (const job of jobDefinitions) {
    if (changedSettingKey) {
      if (job.schedule.kind === "fixed") continue;
      if (job.schedule.settingKey !== changedSettingKey) continue;
    }
    db.prepare("UPDATE jobs SET next_run_at = ? WHERE key = ?").run(
      computeNextRun(job),
      job.key,
    );
  }
}

function acquireLock(jobKey: string, leaseSeconds: number): boolean {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  // Süresi dolmuş kirayı temizle (sahibi çökmüş olabilir).
  db.prepare("DELETE FROM job_locks WHERE job_key = ? AND expires_at < ?").run(jobKey, now);

  try {
    db.prepare(
      "INSERT INTO job_locks (job_key, owner, acquired_at, expires_at) VALUES (?, ?, ?, ?)",
    ).run(jobKey, OWNER, now, now + leaseSeconds);
    return true;
  } catch {
    // Başka bir sahip tutuyor.
    return false;
  }
}

function releaseLock(jobKey: string): void {
  getDb()
    .prepare("DELETE FROM job_locks WHERE job_key = ? AND owner = ?")
    .run(jobKey, OWNER);
}

export async function runJobNow(jobKey: string): Promise<{ ok: boolean; detail: string }> {
  const job = findJob(jobKey);
  if (!job) return { ok: false, detail: serverT("jobs.runner.unknownJob") };
  ensureJobRows();

  if (running.has(job.key)) return { ok: false, detail: serverT("jobs.runner.alreadyRunning") };

  const lease = job.leaseSeconds ?? 300;
  if (!acquireLock(job.key, lease)) {
    return { ok: false, detail: serverT("jobs.runner.alreadyRunning") };
  }
  running.add(job.key);

  const db = getDb();
  const startedAt = Date.now();

  db.prepare("UPDATE jobs SET last_run_at = ?, last_status = 'çalışıyor' WHERE key = ?").run( // i18n-ignore — DB değeri
    Math.floor(startedAt / 1000),
    job.key,
  );

  try {
    const result = await job.run();
    const duration = Date.now() - startedAt;
    const detail = result?.detail ?? "";

    db.prepare(
      // i18n-ignore-next-line — DB değeri (yorum şablonun İÇİNE yazılamaz: SQL'in parçası olur)
      `UPDATE jobs SET last_finish_at = ?, last_duration_ms = ?, last_status = 'başarılı',
                       last_error = NULL, run_count = run_count + 1, next_run_at = ?
       WHERE key = ?`,
    ).run(Math.floor(Date.now() / 1000), duration, computeNextRun(job), job.key);

    if (job.recordSuccessRuns !== false) {
      db.prepare(
        "INSERT INTO job_runs (job_key, started_at, duration_ms, status, detail) VALUES (?, ?, ?, 'başarılı', ?)", // i18n-ignore — DB değeri
      ).run(job.key, Math.floor(startedAt / 1000), duration, detail);
    }

    return { ok: true, detail };
  } catch (error) {
    const duration = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);

    db.prepare(
      `UPDATE jobs SET last_finish_at = ?, last_duration_ms = ?, last_status = 'hata',
                       last_error = ?, fail_count = fail_count + 1, next_run_at = ?
       WHERE key = ?`,
    ).run(Math.floor(Date.now() / 1000), duration, message, computeNextRun(job), job.key);

    db.prepare(
      "INSERT INTO job_runs (job_key, started_at, duration_ms, status, detail) VALUES (?, ?, ?, 'hata', ?)", // i18n-ignore — DB değeri
    ).run(job.key, Math.floor(startedAt / 1000), duration, message);

    console.error(`[jobs] ${job.key} hata:`, message);
    return { ok: false, detail: message };
  } finally {
    running.delete(job.key);
    releaseLock(job.key);
    // Geçmişi sınırla — job_runs sınırsız büyümesin.
    db.prepare(
      `DELETE FROM job_runs WHERE job_key = ? AND id NOT IN
         (SELECT id FROM job_runs WHERE job_key = ? ORDER BY id DESC LIMIT 50)`,
    ).run(job.key, job.key);
  }
}

async function tick(): Promise<void> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  // Tik saniyede bir çalışıyor: iş başına ayrı sorgu yerine tek sorgu.
  const rows = db.prepare("SELECT key, enabled, next_run_at FROM jobs").all() as {
    key: string;
    enabled: number;
    next_run_at: number | null;
  }[];
  const state = new Map(rows.map((row) => [row.key, row]));

  const due: string[] = [];
  for (const job of jobDefinitions) {
    const row = state.get(job.key);
    if (!row || row.enabled !== 1 || running.has(job.key)) continue;

    if (row.next_run_at === null) {
      db.prepare("UPDATE jobs SET next_run_at = ? WHERE key = ?").run(
        computeNextRun(job),
        job.key,
      );
      continue;
    }

    if (row.next_run_at <= now) due.push(job.key);
  }

  // Zamanı gelen işler paralel çalışır: yavaş bir iş, arkasındaki metrik
  // toplamayı geciktirmesin.
  await Promise.all(due.map((key) => runJobNow(key)));
}

export function startScheduler(): void {
  if (timer) return;

  ensureJobRows();
  rescheduleJobs();
  timer = setInterval(() => {
    tick().catch((error) => console.error("[jobs] tick hatası:", error));
  }, TICK_MS);
  // Zamanlayıcı process'in kapanmasını engellemesin.
  timer.unref?.();

  console.log(`[jobs] zamanlayıcı başladı (${jobDefinitions.length} iş, sahip: ${OWNER})`);
}

export function jobStatuses(): JobStatusRow[] {
  const db = getDb();
  const dict = getDictionary(currentLocale());
  ensureJobRows();
  return jobDefinitions.map((job) => {
    const row = db.prepare("SELECT * FROM jobs WHERE key = ?").get(job.key) as {
      enabled: number;
      last_run_at: number | null;
      last_finish_at: number | null;
      last_duration_ms: number | null;
      last_status: string;
      last_error: string | null;
      next_run_at: number | null;
      run_count: number;
      fail_count: number;
    };

    // Ad ve açıklama sözlükten: tanım artık metin taşımıyor. Karşılığı yoksa
    // anahtarın kendisi görünür — boş bir satırdan iyidir.
    const text = jobText(dict, job.key);

    return {
      key: job.key,
      label: text?.label ?? job.key,
      description: text?.description ?? "",
      enabled: row.enabled === 1,
      scheduleKind: job.schedule.kind,
      scheduleText: scheduleText(job),
      lastRunAt: row.last_run_at,
      lastFinishAt: row.last_finish_at,
      lastDurationMs: row.last_duration_ms,
      lastStatus: row.last_status,
      lastError: row.last_error,
      nextRunAt: row.next_run_at,
      runCount: row.run_count,
      failCount: row.fail_count,
    };
  });
}
