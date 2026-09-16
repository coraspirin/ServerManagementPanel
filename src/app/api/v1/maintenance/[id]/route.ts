import { serverT } from "@/lib/i18n/runtime";
import { auditAction } from "@/lib/apiv1/action";
import { maintenancePatchBase, mergePatch, parseId } from "@/lib/apiv1/crud";
import { guardV1 } from "@/lib/apiv1/guard";
import { readJsonBody } from "@/lib/apiv1/parse";
import { apiError, apiOk } from "@/lib/apiv1/respond";
import { serializeMaintenance } from "@/lib/apiv1/serialize";
import {
  deleteMaintenance,
  listMaintenanceWindows,
  parseMaintenanceInput,
  updateMaintenance,
} from "@/lib/monitors/maintenance";
import { getNumber } from "@/lib/settings";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const guard = await guardV1(request, "metrics.view");
  if (!guard.ok) return guard.response;

  const id = parseId((await params).id);
  if (id === null) return apiError("invalid_request", serverT("api.v1.invalidMaintenanceId"));

  const window = listMaintenanceWindows().find((entry) => entry.id === id);
  if (!window) return apiError("not_found", serverT("api.notFound.maintenance"));

  return apiOk({ maintenance: serializeMaintenance(window) });
}

/**
 * Kısmi güncelleme.
 *
 * Birleştirme burada özellikle önemli: `kind` alanına bakan `parseX`,
 * gövdede `kind` yoksa `"once"` varsayıyor. Birleştirme olmasaydı haftalık
 * bir pencereyi `{"enabled": false}` ile kapatmak, onu sessizce tek seferlik
 * bir pencereye çevirip `weekdays` listesini silerdi.
 */
export async function PATCH(request: Request, { params }: Context) {
  const guard = await guardV1(request, "monitors.manage");
  if (!guard.ok) return guard.response;

  const id = parseId((await params).id);
  if (id === null) return apiError("invalid_request", serverT("api.v1.invalidMaintenanceId"));

  const existing = listMaintenanceWindows().find((entry) => entry.id === id);
  if (!existing) return apiError("not_found", serverT("api.notFound.maintenance"));

  const body = await readJsonBody(request, getNumber("api.max_body_bytes"));
  if (!body.ok) return body.response;

  const parsed = parseMaintenanceInput(mergePatch(maintenancePatchBase(existing), body.body));
  if (!parsed.ok) return apiError("invalid_request", parsed.error);

  updateMaintenance(id, parsed.input);

  auditAction(guard.actor, {
    action: "maintenance.update",
    targetType: "maintenance",
    targetId: String(id),
    detail: parsed.input.name,
  });

  const window = listMaintenanceWindows().find((entry) => entry.id === id);
  return apiOk({ maintenance: window ? serializeMaintenance(window) : null });
}

export async function DELETE(request: Request, { params }: Context) {
  const guard = await guardV1(request, "monitors.manage");
  if (!guard.ok) return guard.response;

  const id = parseId((await params).id);
  if (id === null) return apiError("invalid_request", serverT("api.v1.invalidMaintenanceId"));

  const existing = listMaintenanceWindows().find((entry) => entry.id === id);
  if (!existing) return apiError("not_found", serverT("api.notFound.maintenance"));

  deleteMaintenance(id);

  auditAction(guard.actor, {
    action: "maintenance.delete",
    targetType: "maintenance",
    targetId: String(id),
    detail: existing.name,
  });

  return apiOk({ deleted: true, id });
}
