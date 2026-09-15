import { auditAction } from "@/lib/apiv1/action";
import { guardV1 } from "@/lib/apiv1/guard";
import { LIMITS, clampedNumber } from "@/lib/apiv1/paginate";
import { readJsonBody } from "@/lib/apiv1/parse";
import { apiError, apiOk } from "@/lib/apiv1/respond";
import { serializeMaintenance } from "@/lib/apiv1/serialize";
import {
  createMaintenance,
  listMaintenanceWindows,
  parseMaintenanceInput,
} from "@/lib/monitors/maintenance";
import { getNumber } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Bakım pencereleri.
 *
 * Bu uç bir otomasyon için `/api/v1/monitors`ten daha değerli olabilir:
 * "şu an bakımda mıyız" sorusunun cevabı, bir n8n akışının alarm üretip
 * üretmeyeceğini belirler. `active` alanı bu yüzden sunucuda hesaplanıp
 * veriliyor (serialize.ts).
 */
export async function GET(request: Request) {
  const guard = await guardV1(request, "metrics.view");
  if (!guard.ok) return guard.response;

  const search = new URL(request.url).searchParams;
  const limit = clampedNumber(
    search.get("limit"),
    LIMITS.collection.fallback,
    1,
    LIMITS.collection.max,
  );

  const all = listMaintenanceWindows();
  return apiOk({
    hostId: 1,
    maintenance: all.slice(0, limit).map(serializeMaintenance),
    hasMore: all.length > limit,
  });
}

export async function POST(request: Request) {
  const guard = await guardV1(request, "monitors.manage");
  if (!guard.ok) return guard.response;

  const body = await readJsonBody(request, getNumber("api.max_body_bytes"));
  if (!body.ok) return body.response;

  const parsed = parseMaintenanceInput(body.body);
  if (!parsed.ok) return apiError("invalid_request", parsed.error);

  const id = createMaintenance(parsed.input);

  auditAction(guard.actor, {
    action: "maintenance.create",
    targetType: "maintenance",
    targetId: String(id),
    detail: parsed.input.name,
  });

  const window = listMaintenanceWindows().find((entry) => entry.id === id);
  return apiOk(
    { maintenance: window ? serializeMaintenance(window) : null },
    { status: 201, headers: { Location: `/api/v1/maintenance/${id}` } },
  );
}
