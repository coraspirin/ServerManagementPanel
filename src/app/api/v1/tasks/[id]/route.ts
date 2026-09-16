import { serverT } from "@/lib/i18n/runtime";
import { guardV1 } from "@/lib/apiv1/guard";
import { apiError, apiOk } from "@/lib/apiv1/respond";
import { findTask } from "@/lib/apiv1/tasks";

export const dynamic = "force-dynamic";

/**
 * Uzun süren eylemin durumu.
 *
 * İZİN: eylemi başlatanla aynı — yani `findTask` sahibi kontrol ediyor,
 * ayrıca bir `PermissionKey` aranmıyor. Sebep: görevin hangi izni
 * gerektirdiği onu BAŞLATAN uçta zaten sorulmuştu; burada tekrar sormak,
 * arada izni değişen bir kullanıcının kendi başlattığı işin sonucunu
 * göremmesine yol açardı — sonuç zaten gerçekleşmiş olsa bile.
 *
 * `404`ün İKİ ANLAMI VAR ve ikisi de aynı yanıtı veriyor: görev hiç yok, ya
 * da başkasına ait. Ayırmak, `taskId` deneyen birine "bu id var ama senin
 * değil" bilgisini verirdi.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardV1(request, null);
  if (!guard.ok) return guard.response;

  const task = findTask((await params).id, guard.actor.userId);
  if (!task) {
    return apiError(
      "not_found",
      serverT("api.v1.taskMissing", { path: "GET /api/v1/containers/{id}" }),
    );
  }

  return apiOk(
    {
      id: task.id,
      kind: task.kind,
      target: task.target,
      status: task.status,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
      progress: task.progress,
      detail: task.detail,
      error: task.error,
    },
    // Hâlâ çalışıyorsa istemciye ne sıklıkla sorması gerektiğini söyle;
    // daha sık sormasını hız sınırı zaten engelliyor.
    task.status === "running" ? { headers: { "Retry-After": "5" } } : {},
  );
}
