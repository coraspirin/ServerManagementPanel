import "server-only";

import { cookies, headers } from "next/headers";
import { getDb } from "@/lib/db/client";
import { generateToken, hashToken } from "@/lib/crypto";
import { getNumber } from "@/lib/settings";
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  type ActiveSession,
  type PermissionKey,
  type SessionUser,
} from "./types";

/**
 * Oturumun ömrü.
 *
 * "Beni hatırla" işaretlenmişse gün, işaretlenmemişse saat cinsinden ayardan
 * geliyor. Kayan pencere BİLEREK yok: çerezin son kullanma tarihi mutlak ve
 * ancak bir route handler'da yazılabiliyor; her istekte tazelemek için ya
 * middleware'den veritabanına bakmak (Edge çalışma zamanında mümkün değil) ya
 * da her sayfa yüklemesinde fazladan bir uç çağırmak gerekirdi. Uzun mutlak
 * süre istenen davranışı zaten karşılıyor.
 */
function sessionTtlSeconds(remember: boolean): number {
  return remember
    ? getNumber("security.remember_me_days") * 86400
    : getNumber("security.session_ttl_hours") * 3600;
}

type UserRow = {
  id: number;
  username: string;
  display_name: string;
  role_id: number;
  role_name: string;
  must_change_pw: number;
};

function loadPermissions(roleId: number): PermissionKey[] {
  return (
    getDb()
      .prepare("SELECT permission_key FROM role_permissions WHERE role_id = ?")
      .all(roleId) as { permission_key: PermissionKey }[]
  ).map((row) => row.permission_key);
}

function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || row.username,
    roleId: row.role_id,
    roleName: row.role_name,
    mustChangePassword: row.must_change_pw === 1,
    permissions: loadPermissions(row.role_id),
  };
}

export function createSession(
  userId: number,
  meta: { ip: string; userAgent: string },
  options: { remember?: boolean } = {},
): { token: string; csrfToken: string; expiresAt: number } {
  const token = generateToken(32);
  const csrfToken = generateToken(24);
  const expiresAt =
    Math.floor(Date.now() / 1000) + sessionTtlSeconds(options.remember ?? false);

  getDb()
    .prepare(
      `INSERT INTO sessions (token_hash, user_id, csrf_token, ip, user_agent, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(hashToken(token), userId, csrfToken, meta.ip, meta.userAgent.slice(0, 300), expiresAt);

  return { token, csrfToken, expiresAt };
}

/** Süresi dolmuş oturumları temizler. M0.6'da periyodik job'a bağlanacak. */
export function pruneExpiredSessions(): number {
  return getDb()
    .prepare("DELETE FROM sessions WHERE expires_at < unixepoch()")
    .run().changes as number;
}

export function destroySession(token: string): void {
  getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

export function destroyAllSessionsForUser(userId: number): void {
  getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

/** Token'dan aktif oturumu çözer; süresi dolmuşsa siler ve null döner. */
export function resolveSession(token: string): ActiveSession | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT s.csrf_token, s.expires_at,
              u.id, u.username, u.display_name, u.role_id, u.must_change_pw,
              r.name AS role_name
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN roles r ON r.id = u.role_id
       WHERE s.token_hash = ? AND u.is_active = 1`,
    )
    .get(hashToken(token)) as
    | (UserRow & { csrf_token: string; expires_at: number })
    | undefined;

  if (!row) return null;

  if (row.expires_at < Math.floor(Date.now() / 1000)) {
    destroySession(token);
    return null;
  }

  db.prepare("UPDATE sessions SET last_seen_at = unixepoch() WHERE token_hash = ?").run(
    hashToken(token),
  );

  return {
    user: toSessionUser(row),
    csrfToken: row.csrf_token,
    expiresAt: row.expires_at,
  };
}

/** Sunucu bileşenleri ve route handler'ları için geçerli oturum. */
export async function currentSession(): Promise<ActiveSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? resolveSession(token) : null;
}

export async function currentUser(): Promise<SessionUser | null> {
  return (await currentSession())?.user ?? null;
}

export function hasPermission(
  user: SessionUser | null,
  permission: PermissionKey,
): boolean {
  return user?.permissions.includes(permission) ?? false;
}

export async function setSessionCookies(token: string, csrfToken: string, expiresAt: number) {
  const jar = await cookies();

  /*
    `secure` bayrağı SABİT DEĞİL, isteğin şemasından okunuyor (M3.45).

    Panel artık düz HTTP üzerinden yayınlanıyor. `secure: true` sabitken
    tarayıcı çerezi HTTP bağlantısında hiç saklamıyordu: giriş formu doğru
    paroladan sonra da giriş sayfasına dönüyor, hiçbir hata mesajı çıkmıyordu.
    Arızanın sessiz olması en kötü yanıydı — "parolam yanlış mı" diye
    düşündüren, aslında bir aktarım ayarı.

    Şema `X-Forwarded-Proto`dan okunuyor; başlığı ters vekil (Caddy) koyuyor.
    Başlık yoksa HTTP varsayılıyor: yanlış tarafa düşmenin bedeli asimetrik —
    HTTPS'te `secure` olmayan bir çerez çalışır, tersi çalışmaz.
  */
  const proto = (await headers()).get("x-forwarded-proto") ?? "";
  const https = proto.split(",")[0].trim().toLowerCase() === "https";

  const common = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: https,
    path: "/",
    expires: new Date(expiresAt * 1000),
  };

  jar.set(SESSION_COOKIE, token, common);
  // CSRF token'ı JS'in okuyabilmesi gerekir (double-submit) — httpOnly değil.
  jar.set(CSRF_COOKIE, csrfToken, { ...common, httpOnly: false });
}

export async function clearSessionCookies() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(CSRF_COOKIE);
}
