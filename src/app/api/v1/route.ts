import { guardV1 } from "@/lib/apiv1/guard";
import { apiOk } from "@/lib/apiv1/respond";

export const dynamic = "force-dynamic";

/**
 * v1 indeksi — kendini tanıtan uç listesi.
 *
 * İZİN aranmıyor ama KİMLİK aranıyor. Kimliksiz bırakılsaydı, bir ev
 * sunucusunun API yüzeyini listeleyen bedava bir keşif ucu olurdu; canlılık
 * kontrolü için zaten /api/health var ve o iş için yeterli.
 *
 * Ayrıca guardV1'den geçmesi şart: `api.enabled` şalteri orada yaşıyor ve
 * indeksin şalteri atlaması, şalterin tamamını anlamsız kılardı.
 */
export async function GET(request: Request) {
  const guard = await guardV1(request, null);
  if (!guard.ok) return guard.response;

  return apiOk({
    version: 1,
    /*
     * Liste ELLE tutuluyor, dosya sisteminden taranmıyor: tarama henüz
     * belgelenmemiş bir ucu istemeden yayınlardı ve standalone çıktıda dizin
     * yapısı burada göründüğü gibi değil.
     *
     * YALNIZCA GERÇEKTEN VAR OLAN uçlar yazılır. Gelecek fazların uçlarını
     * şimdiden listelemek, indeksi olmayan bir şeyi vaat eden bir belgeye
     * çevirirdi — istemci onlara göre kod yazar ve 404 alırdı. Her faz kendi
     * uçlarını bu diziye ekler.
     */
    endpoints: [
      { path: "/api/v1", methods: ["GET"], permission: null },
      { path: "/api/v1/system", methods: ["GET"], permission: "metrics.view" },
      { path: "/api/v1/hardware", methods: ["GET"], permission: "metrics.view" },
      { path: "/api/v1/metrics/series", methods: ["GET"], permission: "metrics.view" },
      { path: "/api/v1/containers", methods: ["GET"], permission: "docker.view" },
      { path: "/api/v1/containers/{id}", methods: ["GET"], permission: "docker.view" },
      { path: "/api/v1/containers/{id}/logs", methods: ["GET"], permission: "docker.view" },
      { path: "/api/v1/monitors", methods: ["GET", "POST"], permission: "metrics.view" },
      {
        path: "/api/v1/monitors/{id}",
        methods: ["GET", "PATCH", "DELETE"],
        permission: "metrics.view",
        note: "yazma işlemleri monitors.manage ister; PATCH kısmi",
      },
      { path: "/api/v1/events", methods: ["GET"], permission: "metrics.view" },
      { path: "/api/v1/apps", methods: ["GET", "POST"], permission: "panel.view" },
      {
        path: "/api/v1/apps/{id}",
        methods: ["GET", "PATCH", "DELETE"],
        permission: "panel.view",
        note: "yazma işlemleri apps.manage ister; widget yapılandırması v1 dışı",
      },
      { path: "/api/v1/bookmarks", methods: ["GET", "POST"], permission: "panel.view" },
      {
        path: "/api/v1/bookmarks/{id}",
        methods: ["GET", "PATCH", "DELETE"],
        permission: "panel.view",
        note: "yazma işlemleri apps.manage ister",
      },
      { path: "/api/v1/maintenance", methods: ["GET", "POST"], permission: "metrics.view" },
      {
        path: "/api/v1/maintenance/{id}",
        methods: ["GET", "PATCH", "DELETE"],
        permission: "metrics.view",
        note: "yazma işlemleri monitors.manage ister; PATCH kısmi",
      },
      { path: "/metrics", methods: ["GET"], permission: "metrics.view" },
      {
        path: "/api/v1/containers/{id}/actions",
        methods: ["POST"],
        permission: "docker.action",
      },
      {
        path: "/api/v1/containers/{id}/update",
        methods: ["POST"],
        permission: "docker.action",
        note: "202 + taskId; Idempotency-Key destekler",
      },
      { path: "/api/v1/tasks/{id}", methods: ["GET"], permission: null },
      { path: "/api/v1/monitors/{id}/check", methods: ["POST"], permission: "monitors.manage" },
      {
        path: "/api/v1/host/power",
        methods: ["POST"],
        permission: "host.power",
        note: "Idempotency-Key destekler",
      },
      {
        path: "/api/v1/host/services/{unit}/actions",
        methods: ["POST"],
        permission: "host.service",
        note: "Idempotency-Key destekler",
      },
      {
        path: "/api/v1/host/compose",
        methods: ["POST"],
        permission: "host.service",
        note: "Idempotency-Key destekler",
      },
    ],
    actor: {
      username: guard.actor.username,
      via: guard.actor.via,
      permissions: guard.actor.permissions,
    },
    docs: "/docs/API.md",
  });
}
