import { serverT } from "@/lib/i18n/runtime";
import { enterHost, guardHostApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import {
  deleteMonitor,
  getMonitor,
  monitorViews,
  parseMonitorInput,
  updateMonitor,
} from "@/lib/monitors/store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const guard = await guardHostApi(request, "monitors.manage", { agent: true });
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  const id = Number((await params).id);
  const existing = getMonitor(id);
  if (!existing) return Response.json({ error: serverT("api.notFound.monitor") }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const parsed = parseMonitorInput(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  updateMonitor(id, parsed.input);

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "monitors.update",
    targetId: String(id),
    detail: `${existing.target} → ${parsed.input.target}`,
    result: "ok",
  });

  return Response.json({ ok: true, monitors: monitorViews(60, { hostId: guard.hostId }) });
}

export async function DELETE(request: Request, { params }: Context) {
  const guard = await guardHostApi(request, "monitors.manage", { agent: true });
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  const id = Number((await params).id);
  const existing = getMonitor(id);
  if (!existing) return Response.json({ error: serverT("api.notFound.monitor") }, { status: 404 });

  deleteMonitor(id);

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "monitors.delete",
    targetId: String(id),
    detail: existing.name,
    result: "ok",
  });

  return Response.json({ ok: true, monitors: monitorViews(60, { hostId: guard.hostId }) });
}
