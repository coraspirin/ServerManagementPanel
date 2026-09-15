import { randomBytes } from "node:crypto";

/**
 * T12 — uzun süren eylemler için görev kaydı.
 *
 * NEDEN ASENKRON. İç uç (`/api/docker/[id]/update`) SSE ile ilerleme yayınlıyor
 * çünkü tarayıcı bunu gösterebiliyor. Bir script gösteremez ve asıl sorun
 * süre: birkaç GB'lık bir imajın çekilmesi dakikalar sürer. Senkron
 * tutulsaydı hattaki her ara katmanın kendi zaman aşımı devreye girerdi —
 * n8n ve Home Assistant'ın HTTP düğümleri onlarca saniyede keser — ve istemci
 * işlemin BAŞARISIZ olduğunu sanarken iş arkada devam ederdi. Yanlış bilgi
 * veren bir yanıt, geç gelen yanıttan kötüdür.
 *
 * BELLEK İÇİ, tablo yok — hız sınırı kovalarıyla aynı tek-process varsayımı,
 * aynı gerekçe. Kalıcı görev geçmişi isteniyorsa yeri `jobs`/`job_runs`
 * (migration 004), ama bir imaj güncellemesi zamanlanmış iş değil.
 */

export type TaskStatus = "running" | "succeeded" | "failed";

export type Task = {
  id: string;
  kind: string;
  /** Görevi başlatan — `GET /api/v1/tasks/{id}` yalnızca ona açık. */
  ownerUserId: number;
  target: string;
  status: TaskStatus;
  startedAt: number;
  finishedAt: number | null;
  progress: string;
  detail: string;
  error: string | null;
};

/** Kapasite ve ömür: kayıt sınırsız birikmemeli. */
const MAX_TASKS = 100;
const TTL_MS = 3_600_000;

const tasks = new Map<string, Task>();

function sweep(now: number): void {
  for (const [id, task] of tasks) {
    const age = now - (task.finishedAt ?? task.startedAt) * 1000;
    if (age > TTL_MS) tasks.delete(id);
  }

  // Hâlâ doluysa en eskiden başlayarak at. TTL tek başına yetmez: bir saat
  // içinde 100'den fazla görev başlatılabilir.
  while (tasks.size > MAX_TASKS) {
    const oldest = tasks.keys().next();
    if (oldest.done) break;
    tasks.delete(oldest.value);
  }
}

export function createTask(input: {
  kind: string;
  ownerUserId: number;
  target: string;
}): Task {
  const now = Date.now();
  sweep(now);

  const task: Task = {
    // Tahmin edilemez, ama yetki kontrolü buna DAYANMIYOR (bkz. ownerUserId).
    id: `tsk_${randomBytes(12).toString("hex")}`,
    kind: input.kind,
    ownerUserId: input.ownerUserId,
    target: input.target,
    status: "running",
    startedAt: Math.floor(now / 1000),
    finishedAt: null,
    progress: "",
    detail: "",
    error: null,
  };

  tasks.set(task.id, task);
  return task;
}

export function updateProgress(id: string, progress: string): void {
  const task = tasks.get(id);
  if (task && task.status === "running") task.progress = progress;
}

export function finishTask(
  id: string,
  outcome: { status: "succeeded"; detail: string } | { status: "failed"; error: string },
): void {
  const task = tasks.get(id);
  if (!task) return;

  task.status = outcome.status;
  task.finishedAt = Math.floor(Date.now() / 1000);
  if (outcome.status === "succeeded") task.detail = outcome.detail;
  else task.error = outcome.error;
}

/**
 * Görevi okur — YALNIZCA sahibi için.
 *
 * `taskId` tahmin edilemez olsa da yetki kontrolü tahmin edilemezliğe
 * bırakılmaz; kimliği bilinen bir sır, yetki mekanizması değildir.
 */
export function findTask(id: string, userId: number): Task | null {
  const task = tasks.get(id);
  if (!task || task.ownerUserId !== userId) return null;
  return task;
}

/** Yalnızca test için. */
export function clearTasks(): void {
  tasks.clear();
}
