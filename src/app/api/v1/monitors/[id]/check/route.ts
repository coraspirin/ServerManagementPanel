import { serverT } from "@/lib/i18n/runtime";
import { auditAction } from "@/lib/apiv1/action";
import { guardV1 } from "@/lib/apiv1/guard";
import { apiError, apiOk } from "@/lib/apiv1/respond";
import { serializeMonitor } from "@/lib/apiv1/serialize";
import { runMonitorNow } from "@/lib/monitors/run";
import { monitorViews } from "@/lib/monitors/store";

export const dynamic = "force-dynamic";

/**
 * Monitörü hemen kontrol eder.
 *
 * Idempotency kapsam dışı: bir kontrolü iki kez çalıştırmak yalnızca iki
 * ölçüm demek, kalıcı bir yan etki değil.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardV1(request, "monitors.manage");
  if (!guard.ok) return guard.response;

  const id = Number((await params).id);
  if (!Number.isInteger(id)) return apiError("invalid_request", serverT("api.v1.invalidMonitorId"));

  const outcome = await runMonitorNow(id);
  if (!outcome) return apiError("not_found", serverT("api.notFound.monitor"));

  const view = monitorViews(0).find((monitor) => monitor.id === id);

  auditAction(guard.actor, {
    action: "monitors.check",
    targetType: "monitor",
    targetId: String(id),
    detail: outcome.result.ok
      ? serverT("api.v1.checkOk", { ms: outcome.result.latencyMs ?? "?" })
      : serverT("api.v1.checkFailed", { error: outcome.result.error ?? serverT("api.v1.noReason") }),
  });

  return apiOk({
    ok: outcome.result.ok,
    latencyMs: outcome.result.latencyMs,
    error: outcome.result.error ?? null,
    attempts: outcome.attempts,
    // İç uç TÜM monitör listesini döndürüyor (ekran onu tazeliyor);
    // burada yalnızca kontrol edilen monitör dönüyor.
    monitor: view ? serializeMonitor(view) : null,
  });
}
