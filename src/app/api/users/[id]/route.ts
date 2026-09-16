import { serverT } from "@/lib/i18n/runtime";
import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import {
  deleteUser,
  disableTotpFor,
  resetPassword,
  unlockUser,
  updateUser,
} from "@/lib/auth/users";
import { clientIp } from "@/lib/request";
import { directoryPayload } from "../route";

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
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const outcome = updateUser(id, {
    displayName: typeof body.displayName === "string" ? body.displayName : undefined,
    roleId: body.roleId === undefined ? undefined : Number(body.roleId),
    isActive: body.isActive === undefined ? undefined : Boolean(body.isActive),
  });

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "users.update",
    targetType: "user",
    targetId: String(id),
    detail: outcome.ok
      ? `${outcome.result.username} · rol: ${outcome.result.roleName} · ${
          outcome.result.isActive ? "aktif" : "pasif"
        }`
      : outcome.error,
    ip: clientIp(request),
    result: outcome.ok ? "ok" : "error",
  });

  if (!outcome.ok) return Response.json({ error: outcome.error }, { status: 400 });
  return Response.json({ ok: true, ...(await directoryPayload()) });
}

/** Parola sıfırlama, kilit açma ve 2FA sıfırlama — hepsi hedefli aksiyonlar. */
export async function POST(request: Request, { params }: Context) {
  const guard = await guardApi(request, "users.manage");
  if (!guard.ok) return guard.response;

  const id = Number((await params).id);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const action = String(body.action ?? "");
  let outcome: { ok: true; result: { id: number } } | { ok: false; error: string };
  let detail = "";

  switch (action) {
    case "reset-password":
      outcome = resetPassword(id, String(body.password ?? ""), body.mustChange !== false);
      detail = serverT("api.users.passwordReset");
      break;
    case "unlock":
      outcome = unlockUser(id);
      detail = serverT("api.users.unlocked");
      break;
    case "reset-2fa":
      // Telefonunu kaybeden ve kurtarma kodu da kalmayan kullanıcının tek yolu.
      outcome = disableTotpFor(id);
      detail = serverT("api.users.totpReset");
      break;
    default:
      return Response.json({ error: serverT("api.unknownAction") }, { status: 400 });
  }

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: `users.${action}`,
    targetType: "user",
    targetId: String(id),
    detail: outcome.ok ? detail : outcome.error,
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
  if (id === guard.session.user.id) {
    return Response.json({ error: serverT("api.users.cannotDeleteSelf") }, { status: 400 });
  }

  const outcome = deleteUser(id);

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "users.delete",
    targetType: "user",
    targetId: String(id),
    detail: outcome.ok ? "silindi" : outcome.error,
    ip: clientIp(request),
    result: outcome.ok ? "ok" : "error",
  });

  if (!outcome.ok) return Response.json({ error: outcome.error }, { status: 400 });
  return Response.json({ ok: true, ...(await directoryPayload()) });
}
