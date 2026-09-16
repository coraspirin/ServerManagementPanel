import { serverT } from "@/lib/i18n/runtime";
import { auditAction } from "@/lib/apiv1/action";
import { mergePatch, monitorPatchBase, parseId } from "@/lib/apiv1/crud";
import { guardV1 } from "@/lib/apiv1/guard";
import { readJsonBody } from "@/lib/apiv1/parse";
import { apiError, apiOk } from "@/lib/apiv1/respond";
import { serializeMonitor } from "@/lib/apiv1/serialize";
import {
  deleteMonitor,
  getMonitor,
  monitorViews,
  parseMonitorInput,
  updateMonitor,
} from "@/lib/monitors/store";
import { getNumber } from "@/lib/settings";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const guard = await guardV1(request, "metrics.view");
  if (!guard.ok) return guard.response;

  const id = parseId((await params).id);
  if (id === null) return apiError("invalid_request", serverT("api.v1.invalidMonitorId"));

  const view = monitorViews(0).find((monitor) => monitor.id === id);
  if (!view) return apiError("not_found", serverT("api.notFound.monitor"));

  return apiOk({ monitor: serializeMonitor(view) });
}

/**
 * Kısmi güncelleme — GERÇEK birleştirme.
 *
 * Panelin kendi ucu gövdeyi doğrudan `parseMonitorInput`'a veriyor, yani
 * gönderilmeyen alanlar varsayılana dönüyor (form her alanı gönderdiği için
 * orada sorun değil). Burada mevcut kayıt taban alınıyor; gerekçesi
 * `crud.ts`'in başında.
 */
export async function PATCH(request: Request, { params }: Context) {
  const guard = await guardV1(request, "monitors.manage");
  if (!guard.ok) return guard.response;

  const id = parseId((await params).id);
  if (id === null) return apiError("invalid_request", serverT("api.v1.invalidMonitorId"));

  const existing = getMonitor(id);
  if (!existing) return apiError("not_found", serverT("api.notFound.monitor"));

  const body = await readJsonBody(request, getNumber("api.max_body_bytes"));
  if (!body.ok) return body.response;

  const parsed = parseMonitorInput(mergePatch(monitorPatchBase(existing), body.body));
  if (!parsed.ok) return apiError("invalid_request", parsed.error);

  updateMonitor(id, parsed.input);

  auditAction(guard.actor, {
    action: "monitors.update",
    targetType: "monitor",
    targetId: String(id),
    detail:
      existing.target === parsed.input.target
        ? existing.name
        : `${existing.target} → ${parsed.input.target}`,
  });

  const view = monitorViews(0).find((monitor) => monitor.id === id);
  return apiOk({ monitor: view ? serializeMonitor(view) : null });
}

export async function DELETE(request: Request, { params }: Context) {
  const guard = await guardV1(request, "monitors.manage");
  if (!guard.ok) return guard.response;

  const id = parseId((await params).id);
  if (id === null) return apiError("invalid_request", serverT("api.v1.invalidMonitorId"));

  const existing = getMonitor(id);
  if (!existing) return apiError("not_found", serverT("api.notFound.monitor"));

  deleteMonitor(id);

  auditAction(guard.actor, {
    action: "monitors.delete",
    targetType: "monitor",
    targetId: String(id),
    detail: existing.name,
  });

  // Silinen kaynağın son hâli DÖNMÜYOR, yalnızca kimliği. Silinmiş bir kaydın
  // gövdesini döndürmek, istemciye artık var olmayan bir şeyi işlemeye devam
  // edebileceğini düşündürür.
  return apiOk({ deleted: true, id });
}
