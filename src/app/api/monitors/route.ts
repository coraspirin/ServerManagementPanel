import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { createMonitor, monitorViews, parseMonitorInput } from "@/lib/monitors/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await guardApi(request, "metrics.view");
  if (!guard.ok) return guard.response;

  return Response.json({ monitors: monitorViews() });
}

export async function POST(request: Request) {
  const guard = await guardApi(request, "monitors.manage");
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "geçersiz istek" }, { status: 400 });
  }

  const parsed = parseMonitorInput(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const id = createMonitor(parsed.input);

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "monitors.create",
    targetId: String(id),
    detail: `${parsed.input.type} → ${parsed.input.target}`,
    result: "ok",
  });

  return Response.json({ ok: true, id, monitors: monitorViews() });
}
