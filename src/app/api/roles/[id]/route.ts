import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { deleteRole, updateRole } from "@/lib/auth/users";
import { clientIp } from "@/lib/request";
import { directoryPayload } from "../../users/route";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const guard = await guardApi(request, "users.manage");
  if (!guard.ok) return guard.response;

  const id = Number((await params).id);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "geçersiz istek" }, { status: 400 });
  }

  const outcome = updateRole(id, {
    name: typeof body.name === "string" ? body.name : undefined,
    description: typeof body.description === "string" ? body.description : undefined,
    permissions: Array.isArray(body.permissions) ? body.permissions.map(String) : undefined,
  });

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "roles.update",
    targetType: "role",
    targetId: String(id),
    detail: outcome.ok
      ? `${outcome.result.name} · ${outcome.result.permissions.length} izin`
      : outcome.error,
    ip: clientIp(request),
    result: outcome.ok ? "ok" : "error",
  });

  if (!outcome.ok) return Response.json({ error: outcome.error }, { status: 400 });
  return Response.json({ ok: true, ...(await directoryPayload()) });
}

export async function DELETE(request: Request, { params }: Context) {
  const guard = await guardApi(request, "users.manage");
  if (!guard.ok) return guard.response;

  const id = Number((await params).id);
  const outcome = deleteRole(id);

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "roles.delete",
    targetType: "role",
    targetId: String(id),
    detail: outcome.ok ? "silindi" : outcome.error,
    ip: clientIp(request),
    result: outcome.ok ? "ok" : "error",
  });

  if (!outcome.ok) return Response.json({ error: outcome.error }, { status: 400 });
  return Response.json({ ok: true, ...(await directoryPayload()) });
}
