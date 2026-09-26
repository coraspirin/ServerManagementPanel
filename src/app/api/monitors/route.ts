import { serverT } from "@/lib/i18n/runtime";
import { enterHost, guardHostApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { createMonitor, monitorViews, parseMonitorInput } from "@/lib/monitors/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await guardHostApi(request, "metrics.view", { agent: true });
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  return Response.json({ monitors: monitorViews(60, { hostId: guard.hostId }) });
}

export async function POST(request: Request) {
  const guard = await guardHostApi(request, "monitors.manage", { agent: true });
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
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

  return Response.json({ ok: true, id, monitors: monitorViews(60, { hostId: guard.hostId }) });
}
