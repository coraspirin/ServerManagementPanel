import { auditAction, beginIdempotent, completeIdempotent } from "@/lib/apiv1/action";
import { guardV1 } from "@/lib/apiv1/guard";
import { apiError, apiOk } from "@/lib/apiv1/respond";
import { createTask, finishTask, updateProgress } from "@/lib/apiv1/tasks";
import { updateContainerImage } from "@/lib/docker/update";
import { dockerOverview } from "@/lib/docker/view";
import { isMockMode } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Görevin kendi üst sınırı — helper'ın CONSOLE_TIMEOUT_MS'iyle (910 sn) hizalı. */
const TASK_TIMEOUT_MS = 900_000;

/**
 * Image güncellemesi — `202 Accepted` + `taskId`, sonra poll.
 *
 * Gerekçe `lib/apiv1/tasks.ts` başında. Özet: pull dakikalar sürer, senkron
 * bir yanıt hattaki ara katmanların zaman aşımına takılır ve istemci işlemin
 * başarısız olduğunu sanarken iş arkada devam eder.
 *
 * ⚠️ PROCESS YENİDEN BAŞLARSA: panel `docker` CLI'ını alt süreç olarak
 * çalıştırıyor ama asıl işi CLI yapmıyor — mount edilmiş sokete bağlanıp
 * HOST'taki `dockerd`'ye söylüyor. Container yeniden başlatıldığında CLI ölür,
 * `dockerd` ölmez: imaj çekme kesilmez, devam eder ve büyük ihtimalle
 * tamamlanır. Bu yüzden görev kaydının kaybolması "iptal edildi" DEMEK
 * DEĞİLDİR — `GET /api/v1/tasks/{id}` 404'ünün anlamı `docs/API.md`'de
 * "durum bilinmiyor, container'ı kontrol edin" olarak yazılı.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardV1(request, "docker.action");
  if (!guard.ok) return guard.response;

  const idem = beginIdempotent(request, guard.actor);
  if (idem.kind === "invalid") return idem.response;
  // Aynı anahtarla gelen ikinci istek ikinci bir pull başlatmaz; ilk yanıt
  // (aynı taskId ile) tekrarlanır.
  if (idem.kind === "replay") return idem.response;

  if (isMockMode()) {
    return apiError(
      "upstream_error",
      "MOCK_MODE açıkken image güncellenemez — gerçek bir Docker gerekiyor.",
    );
  }

  const id = (await params).id;
  const overview = await dockerOverview();
  if (overview.error !== null) return apiError("upstream_error", overview.error);

  const target = overview.containers.find(
    (item) => item.id === id || item.name === id || item.id.startsWith(id),
  );
  if (!target) return apiError("not_found", "container bulunamadı");

  const task = createTask({
    kind: "container.update",
    ownerUserId: guard.actor.userId,
    target: target.name,
  });

  const actor = guard.actor;

  // Bilerek `await` EDİLMİYOR: yanıt hemen dönmeli. Yakalanmayan bir reddi
  // süreç düzeyinde hataya çevirmemek için zincir kendi `catch`ini taşıyor.
  void runUpdate(task.id, target.id, target.name, actor);

  return completeIdempotent(
    idem.context,
    guard.actor,
    apiOk(
      {
        taskId: task.id,
        status: task.status,
        container: target.name,
        pollUrl: `/api/v1/tasks/${task.id}`,
      },
      { status: 202, headers: { "Retry-After": "5" } },
    ),
  );
}

async function runUpdate(
  taskId: string,
  containerId: string,
  containerName: string,
  actor: Parameters<typeof auditAction>[0],
): Promise<void> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error("güncelleme 900 saniyede tamamlanmadı")),
      TASK_TIMEOUT_MS,
    ),
  );

  try {
    const result = await Promise.race([
      updateContainerImage(containerId, (step) => updateProgress(taskId, String(step))),
      timeout,
    ]);

    const detail = result.changed
      ? `güncellendi · eski image ${result.oldImageId.slice(7, 19)} → yeni ${result.newImageId.slice(7, 19)}`
      : "zaten güncel";

    finishTask(taskId, { status: "succeeded", detail });
    auditAction(actor, {
      action: "docker.image_update",
      targetType: "container",
      targetId: containerName,
      detail,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "güncelleme başarısız";
    finishTask(taskId, { status: "failed", error: message });
    auditAction(actor, {
      action: "docker.image_update",
      targetType: "container",
      targetId: containerName,
      detail: message,
      result: "error",
    });
  }
}
