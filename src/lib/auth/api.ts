import "server-only";

import { currentSession, hasPermission } from "./session";
import { CSRF_HEADER, type ActiveSession, type PermissionKey } from "./types";
import { safeEquals } from "@/lib/crypto";

/**
 * Route handler'lar için yetki kapısı.
 *
 * Başarısızlıkta hazır bir `Response` döndürür; çağıran taraf onu doğrudan
 * return eder. Böylece her uçta aynı kontrolleri tekrar yazmak gerekmez.
 */
export type ApiGuardResult =
  | { ok: true; session: ActiveSession }
  | { ok: false; response: Response };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function guardApi(
  request: Request,
  permission: PermissionKey,
): Promise<ApiGuardResult> {
  const session = await currentSession();

  if (!session) {
    return {
      ok: false,
      response: Response.json({ error: "oturum gerekli" }, { status: 401 }),
    };
  }

  // T6 — CSRF: durum değiştiren isteklerde double-submit token doğrulaması.
  // Çerez JS'e açık, başlık ise yalnızca aynı köken üzerinden gönderilebilir.
  if (!SAFE_METHODS.has(request.method)) {
    const header = request.headers.get(CSRF_HEADER) ?? "";
    if (!header || !safeEquals(header, session.csrfToken)) {
      return {
        ok: false,
        response: Response.json({ error: "CSRF doğrulaması başarısız" }, { status: 403 }),
      };
    }
  }

  if (!hasPermission(session.user, permission)) {
    return {
      ok: false,
      response: Response.json({ error: "bu işlem için yetkiniz yok" }, { status: 403 }),
    };
  }

  return { ok: true, session };
}
