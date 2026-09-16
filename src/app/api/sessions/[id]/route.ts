import { serverT } from "@/lib/i18n/runtime";
import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { revokeSession } from "@/lib/auth/users";
import { hashToken } from "@/lib/crypto";
import { clientIp } from "@/lib/request";
import { SESSION_COOKIE } from "@/lib/auth/types";
import { cookies } from "next/headers";
import { directoryPayload } from "../../users/route";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * Oturum sonlandırma. Kimlik olarak token'ın sha256 özeti kullanılıyor —
 * listede de o gösteriliyor, çünkü token'ın kendisi veritabanında yok.
 */
export async function DELETE(request: Request, { params }: Context) {
  const guard = await guardApi(request, "users.manage");
  if (!guard.ok) return guard.response;

  const tokenHash = (await params).id;
  const own = (await cookies()).get(SESSION_COOKIE)?.value;
  if (own && hashToken(own) === tokenHash) {
    return Response.json(
      { error: serverT("api.sessions.current") },
      { status: 400 },
    );
  }

  const removed = revokeSession(tokenHash);

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "sessions.revoke",
    targetType: "session",
    targetId: tokenHash.slice(0, 12),
    detail: removed ? serverT("api.sessions.closed") : serverT("api.notFound.session"),
    ip: clientIp(request),
    result: removed ? "ok" : "error",
  });

  if (!removed) return Response.json({ error: serverT("api.notFound.session") }, { status: 404 });
  return Response.json({ ok: true, ...(await directoryPayload()) });
}
