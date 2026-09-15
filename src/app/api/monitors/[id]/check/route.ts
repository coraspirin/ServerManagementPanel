import { guardApi } from "@/lib/auth/api";
import { runMonitorNow } from "@/lib/monitors/run";
import { monitorViews } from "@/lib/monitors/store";

export const dynamic = "force-dynamic";

/** Monitörü hemen kontrol eder — kurarken doğru yapılandırdığını görebilmek için. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardApi(request, "monitors.manage");
  if (!guard.ok) return guard.response;

  const outcome = await runMonitorNow(Number((await params).id));
  if (!outcome) return Response.json({ error: "monitör bulunamadı" }, { status: 404 });

  return Response.json({
    ok: outcome.result.ok,
    latencyMs: outcome.result.latencyMs,
    error: outcome.result.error ?? null,
    attempts: outcome.attempts,
    monitors: monitorViews(),
  });
}
