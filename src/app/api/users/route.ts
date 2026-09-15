import { cookies } from "next/headers";

import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { SESSION_COOKIE } from "@/lib/auth/types";
import {
  createUser,
  listPermissions,
  listRoles,
  listSessions,
  listUsers,
} from "@/lib/auth/users";
import { clientIp } from "@/lib/request";

export const dynamic = "force-dynamic";

/** Ekranın tek seferde ihtiyaç duyduğu her şey — dört ayrı istek atmasın. */
export async function directoryPayload(): Promise<{
  users: ReturnType<typeof listUsers>;
  roles: ReturnType<typeof listRoles>;
  permissions: ReturnType<typeof listPermissions>;
  sessions: ReturnType<typeof listSessions>;
}> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? null;
  return {
    users: listUsers(),
    roles: listRoles(),
    permissions: listPermissions(),
    sessions: listSessions(token),
  };
}

export async function GET(request: Request) {
  const guard = await guardApi(request, "users.manage");
  if (!guard.ok) return guard.response;
  return Response.json(await directoryPayload());
}

export async function POST(request: Request) {
  const guard = await guardApi(request, "users.manage");
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "geçersiz istek" }, { status: 400 });
  }

  const outcome = createUser({
    username: String(body.username ?? ""),
    displayName: String(body.displayName ?? ""),
    password: String(body.password ?? ""),
    roleId: Number(body.roleId ?? 0),
    // Yönetici birine parola belirlediyse o parolayı yönetici de biliyor
    // demektir; varsayılan olarak ilk girişte değiştirilmesi istenir.
    mustChangePassword: body.mustChangePassword !== false,
  });

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "users.create",
    targetType: "user",
    targetId: String(body.username ?? ""),
    detail: outcome.ok ? `rol: ${outcome.result.roleName}` : outcome.error,
    ip: clientIp(request),
    result: outcome.ok ? "ok" : "error",
  });

  if (!outcome.ok) return Response.json({ error: outcome.error }, { status: 400 });
  return Response.json({ ok: true, ...(await directoryPayload()) });
}
