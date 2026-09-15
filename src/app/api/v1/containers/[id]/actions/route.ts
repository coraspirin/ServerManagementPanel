import { auditAction } from "@/lib/apiv1/action";
import { guardV1 } from "@/lib/apiv1/guard";
import { readJsonBody } from "@/lib/apiv1/parse";
import { apiError, apiOk } from "@/lib/apiv1/respond";
import { serializeContainer } from "@/lib/apiv1/serialize";
import { dockerOverview } from "@/lib/docker/view";
import { getDockerProvider } from "@/lib/providers";
import type { ContainerAction } from "@/lib/providers/types";
import { getNumber } from "@/lib/settings";

export const dynamic = "force-dynamic";

const ALLOWED: ContainerAction[] = ["start", "stop", "restart", "pause", "unpause"];

/**
 * Container eylemi.
 *
 * IDEMPOTENCY KAPSAM DIŞI — bilerek. Bu eylemler zaten tekrarlanabilir: iki
 * kez `restart`, bir kez `restart`tan farklı bir duruma götürmez. Anahtar
 * mekanizmasını buraya da yaymak, hiçbir sorunu olmayan bir uca ek yük
 * eklemek olurdu.
 *
 * Her çağrı audit'e düşer — SONUÇTAN BAĞIMSIZ olarak. "Bu servis neden gece
 * 3'te yeniden başladı" sorusunun cevabı bir yerde yazılı olmalı ve token'la
 * yapıldıysa hangi anahtarla yapıldığı da.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardV1(request, "docker.action");
  if (!guard.ok) return guard.response;

  const body = await readJsonBody<{ action?: unknown }>(
    request,
    getNumber("api.max_body_bytes"),
  );
  if (!body.ok) return body.response;

  const action = String(body.body.action ?? "") as ContainerAction;
  if (!ALLOWED.includes(action)) {
    return apiError("invalid_request", `geçersiz eylem. Geçerli değerler: ${ALLOWED.join(", ")}`);
  }

  const id = (await params).id;

  // Kanonik id'ye çevir: ad, tam id ve id öneki üç uçta da aynı çalışmalı.
  const overview = await dockerOverview();
  if (overview.error !== null) return apiError("upstream_error", overview.error);

  const target = overview.containers.find(
    (item) => item.id === id || item.name === id || item.id.startsWith(id),
  );
  if (!target) return apiError("not_found", "container bulunamadı");

  try {
    await getDockerProvider().action(target.id, action, getNumber("docker.stop_timeout"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "bilinmeyen hata";
    auditAction(guard.actor, {
      action: `docker.${action}`,
      targetType: "container",
      targetId: target.name,
      detail: message,
      result: "error",
    });
    return apiError("upstream_error", message);
  }

  auditAction(guard.actor, {
    action: `docker.${action}`,
    targetType: "container",
    targetId: target.name,
  });

  // Eylemden SONRAKİ durum okunuyor: istemci ikinci bir istek atmak zorunda
  // kalmasın. İç uç tüm docker özetini döndürüyor (ekran onu tazeliyor);
  // burada yalnızca dokunulan container dönüyor — v1 yanıtları isteğin
  // konusuyla sınırlı kalmalı.
  const after = await dockerOverview();
  const updated =
    after.error === null ? after.containers.find((item) => item.id === target.id) : undefined;

  return apiOk({
    ok: true,
    action,
    container: serializeContainer(updated ?? target),
  });
}
