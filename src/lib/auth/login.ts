import "server-only";
import { serverT } from "@/lib/i18n/runtime";

import { getDb } from "@/lib/db/client";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { getNumber } from "@/lib/settings";
import { audit } from "./audit";

/**
 * T6 — kaba kuvvet koruması.
 *
 * Sayaç kullanıcı satırında tutuluyor (bellekte değil): panel ve worker ayrı
 * process olduğu için bellekteki sayaç güvenilmez, ayrıca yeniden başlatma
 * kilidi sıfırlamamalı. Eşikler ayarlardan okunur (T9).
 */
function maxAttempts(): number {
  return getNumber("security.login_max_attempts");
}

function lockoutSeconds(): number {
  return getNumber("security.lockout_minutes") * 60;
}

export type LoginResult =
  | { ok: true; userId: number; mustChangePassword: boolean }
  | { ok: false; reason: "invalid" | "locked" | "inactive"; retryAfterSeconds?: number };

type Row = {
  id: number;
  password_hash: string;
  is_active: number;
  must_change_pw: number;
  failed_attempts: number;
  locked_until: number | null;
};

export function attemptLogin(username: string, password: string, ip: string): LoginResult {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const user = db
    .prepare(
      `SELECT id, password_hash, is_active, must_change_pw, failed_attempts, locked_until
       FROM users WHERE username = ?`,
    )
    .get(username) as Row | undefined;

  // Kullanıcı yoksa da parola doğrulaması kadar zaman harcanmalı ki
  // yanıt süresinden kullanıcı adı varlığı çıkarılamasın.
  if (!user) {
    verifyPassword(password, hashPassword("zaman-esitleme"));
    audit({
      username,
      action: "auth.login",
      result: "denied",
      ip,
      detail: serverT("loginAudit.noUser"),
    });
    return { ok: false, reason: "invalid" };
  }

  if (user.locked_until && user.locked_until > now) {
    audit({
      userId: user.id,
      username,
      action: "auth.login",
      result: "denied",
      ip,
      detail: serverT("loginAudit.locked"),
    });
    return { ok: false, reason: "locked", retryAfterSeconds: user.locked_until - now };
  }

  if (user.is_active !== 1) {
    audit({
      userId: user.id,
      username,
      action: "auth.login",
      result: "denied",
      ip,
      detail: serverT("loginAudit.inactive"),
    });
    return { ok: false, reason: "inactive" };
  }

  if (!verifyPassword(password, user.password_hash)) {
    const limit = maxAttempts();
    const lockFor = lockoutSeconds();
    const attempts = user.failed_attempts + 1;
    const lockedUntil = attempts >= limit ? now + lockFor : null;

    db.prepare("UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?").run(
      attempts,
      lockedUntil,
      user.id,
    );

    audit({
      userId: user.id,
      username,
      action: "auth.login",
      result: "denied",
      ip,
      detail: lockedUntil
        ? serverT("loginAudit.wrongPasswordLocked", { attempts, minutes: lockFor / 60 })
        : serverT("loginAudit.wrongPassword", { attempts, limit }),
    });

    return lockedUntil
      ? { ok: false, reason: "locked", retryAfterSeconds: lockFor }
      : { ok: false, reason: "invalid" };
  }

  db.prepare(
    "UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?",
  ).run(now, user.id);

  audit({ userId: user.id, username, action: "auth.login", result: "ok", ip });

  return { ok: true, userId: user.id, mustChangePassword: user.must_change_pw === 1 };
}

export function changePassword(userId: number, newPassword: string): void {
  getDb()
    .prepare("UPDATE users SET password_hash = ?, must_change_pw = 0 WHERE id = ?")
    .run(hashPassword(newPassword), userId);
}
