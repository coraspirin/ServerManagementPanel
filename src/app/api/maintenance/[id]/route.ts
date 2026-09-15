import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import {
  deleteMaintenance,
  listMaintenanceWindows,
  parseMaintenanceInput,
  updateMaintenance,
} from "@/lib/monitors/maintenance";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const guard = await guardApi(request, "monitors.manage");
  if (!guard.ok) return guard.response;

  const id = Number((await params).id);
  if (!listMaintenanceWindows().some((w) => w.id === id)) {
    return Response.json({ error: "bakım penceresi bulunamadı" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "geçersiz istek" }, { status: 400 });
  }

  const parsed = parseMaintenanceInput(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  updateMaintenance(id, parsed.input);

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "maintenance.update",
    targetId: String(id),
    detail: parsed.input.name,
    result: "ok",
  });

  return Response.json({ ok: true, windows: listMaintenanceWindows() });
}

export async function DELETE(request: Request, { params }: Context) {
  const guard = await guardApi(request, "monitors.manage");
  if (!guard.ok) return guard.response;

  const id = Number((await params).id);
  const existing = listMaintenanceWindows().find((w) => w.id === id);
  if (!existing) {
    return Response.json({ error: "bakım penceresi bulunamadı" }, { status: 404 });
  }

  deleteMaintenance(id);

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "maintenance.delete",
    targetId: String(id),
    detail: existing.name,
    result: "ok",
  });

  return Response.json({ ok: true, windows: listMaintenanceWindows() });
}
