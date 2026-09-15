import { cookies } from "next/headers";
import { audit } from "@/lib/auth/audit";
import { clearSessionCookies, destroySession, resolveSession } from "@/lib/auth/session";
import { SESSION_COOKIE } from "@/lib/auth/types";
import { clientIp } from "@/lib/request";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  if (token) {
    const session = resolveSession(token);
    if (session) {
      audit({
        userId: session.user.id,
        username: session.user.username,
        action: "auth.logout",
        ip: clientIp(request),
      });
    }
    destroySession(token);
  }

  await clearSessionCookies();
  return Response.json({ ok: true });
}
