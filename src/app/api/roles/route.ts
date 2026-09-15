import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { createRole } from "@/lib/auth/users";
import { clientIp } from "@/lib/request";
import { directoryPayload } from "../users/route";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guard = await guardApi(request, "users.manage");
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "geçersiz istek" }, { status: 400 });
  }

  const outcome = createRole({
    name: String(body.name ?? ""),
    description: String(body.description ?? ""),
    permissions: Array.isArray(body.permissions) ? body.permissions.map(String) : [],
  });

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "roles.create",
    targetType: "role",
    targetId: String(body.name ?? ""),
    detail: outcome.ok ? `${outcome.result.permissions.length} izin` : outcome.error,
    ip: clientIp(request),
    result: outcome.ok ? "ok" : "error",
  });

  if (!outcome.ok) return Response.json({ error: outcome.error }, { status: 400 });
  return Response.json({ ok: true, ...(await directoryPayload()) });
}
