import "server-only";

import { redirect } from "next/navigation";
import { currentSession, hasPermission } from "./session";
import type { ActiveSession, PermissionKey } from "./types";

/**
 * Sayfalar için: oturum yoksa /login'e yollar.
 *
 * middleware.ts yalnızca çerez VARLIĞINA bakar (Edge runtime'da veritabanına
 * erişilemez); oturumun gerçekten geçerli olduğu burada doğrulanır.
 */
export async function requireSession(returnTo?: string): Promise<ActiveSession> {
  const session = await currentSession();
  if (!session) {
    redirect(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login");
  }
  return session;
}

export async function requirePermission(permission: PermissionKey): Promise<ActiveSession> {
  const session = await requireSession();
  if (!hasPermission(session.user, permission)) {
    redirect("/?forbidden=1");
  }
  return session;
}
