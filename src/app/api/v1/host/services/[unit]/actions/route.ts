import { beginIdempotent } from "@/lib/apiv1/action";
import { guardV1 } from "@/lib/apiv1/guard";
import { runHelperAction } from "@/lib/apiv1/host";
import { readJsonBody } from "@/lib/apiv1/parse";
import { apiError } from "@/lib/apiv1/respond";
import type { HelperAction } from "@/lib/host/helper";
import { getNumber } from "@/lib/settings";

export const dynamic = "force-dynamic";

const ACTIONS: Record<string, HelperAction> = {
  status: "service.status",
  start: "service.start",
  stop: "service.stop",
  restart: "service.restart",
};

/**
 * systemd birimi üzerinde işlem.
 *
 * Birim adı DOĞRULANMIYOR burada — host'taki `allow.conf` her birim için bir
 * desen tutuyor ve gerçek sınır orada. Panelde ikinci bir liste tutmak,
 * host'takiyle ayrışacak ve "panelde izinli görünüyor ama çalışmıyor" gibi
 * açıklanması zor bir durum üretecekti. Yine de kaba biçim kontrolü var:
 * boşluk ve kabuk karakteri içeren bir ad, helper'a hiç gitmeden reddediliyor.
 */
export async function POST(request: Request, { params }: { params: Promise<{ unit: string }> }) {
  const guard = await guardV1(request, "host.service");
  if (!guard.ok) return guard.response;

  const idem = beginIdempotent(request, guard.actor);
  if (idem.kind === "invalid") return idem.response;
  if (idem.kind === "replay") return idem.response;

  const unit = decodeURIComponent((await params).unit);
  if (!/^[A-Za-z0-9_.@:-]{1,128}$/.test(unit)) {
    return apiError("invalid_request", "geçersiz birim adı");
  }

  const body = await readJsonBody<{ action?: unknown }>(
    request,
    getNumber("api.max_body_bytes"),
  );
  if (!body.ok) return body.response;

  const requested = String(body.body.action ?? "");
  const action = ACTIONS[requested];
  if (!action) {
    return apiError(
      "invalid_request",
      `geçersiz eylem. Geçerli değerler: ${Object.keys(ACTIONS).join(", ")}`,
    );
  }

  return runHelperAction({
    actor: guard.actor,
    action,
    args: { unit },
    idempotency: idem.context,
    auditAction: `host.service_${requested}`,
    targetId: unit,
  });
}
