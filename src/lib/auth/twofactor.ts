import "server-only";

import { getDb } from "@/lib/db/client";
import {
  decryptSecret,
  encryptSecret,
  generateToken,
  hashToken,
  type EncryptedValue,
} from "@/lib/crypto";
import {
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeRecoveryCode,
  otpauthUri,
  verifyTotp,
} from "./totp";

/**
 * M3.1 — iki adımlı doğrulama.
 *
 * Kayıt iki aşamalı: sır üretilip saklanır ama `totp_enabled` 0 kalır. Kullanıcı
 * telefonundan bir kod girip doğrulayana kadar 2FA açılmaz. Aksi halde QR'ı
 * okutamayan biri kendi hesabından kilitlenirdi.
 */

const CHALLENGE_TTL_SECONDS = 300;
const MAX_CHALLENGE_ATTEMPTS = 5;

function issuer(): string {
  return "Sunucu Paneli";
}

type SecretRow = { totp_secret: string; totp_enabled: number; username: string };

function readSecret(userId: number): { secret: string | null; enabled: boolean; username: string } {
  const row = getDb()
    .prepare("SELECT totp_secret, totp_enabled, username FROM users WHERE id = ?")
    .get(userId) as SecretRow | undefined;

  if (!row) return { secret: null, enabled: false, username: "" };
  if (!row.totp_secret) {
    return { secret: null, enabled: false, username: String(row.username) };
  }

  try {
    const secret = decryptSecret(JSON.parse(row.totp_secret) as EncryptedValue);
    return { secret, enabled: Number(row.totp_enabled) === 1, username: String(row.username) };
  } catch {
    // MASTER_KEY değişmişse sır çözülemez. Bu kullanıcı 2FA'yı geçemez; hesabı
    // kilitlememek için "2FA yok" gibi davranmıyoruz — sessizce yetki vermek
    // güvenlik açığı olurdu. Yönetici 2FA'yı sıfırlamalı.
    console.error(
      `[2fa] kullanıcı ${userId} TOTP sırrı çözülemedi — MASTER_KEY değişmiş olabilir. ` +
        "Yönetici Kullanıcılar ekranından 2FA'yı sıfırlayabilir.",
    );
    return { secret: null, enabled: Number(row.totp_enabled) === 1, username: String(row.username) };
  }
}

export function totpEnabled(userId: number): boolean {
  const row = getDb().prepare("SELECT totp_enabled FROM users WHERE id = ?").get(userId) as
    | { totp_enabled: number }
    | undefined;
  return row !== undefined && Number(row.totp_enabled) === 1;
}

export type Enrollment = { secret: string; uri: string };

/** Yeni bir sır üretip saklar (henüz etkin değil) ve QR için URI döner. */
export function beginEnrollment(userId: number, username: string): Enrollment {
  const secret = generateTotpSecret();
  getDb()
    .prepare("UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?")
    .run(JSON.stringify(encryptSecret(secret)), userId);

  return { secret, uri: otpauthUri(secret, username, issuer()) };
}

export type ConfirmResult =
  | { ok: true; recoveryCodes: string[] }
  | { ok: false; error: string };

export function confirmEnrollment(userId: number, code: string): ConfirmResult {
  const { secret } = readSecret(userId);
  if (!secret) return { ok: false, error: "Önce QR kodu üretilmeli." };
  if (!verifyTotp(secret, code)) {
    return { ok: false, error: "Kod doğrulanamadı. Telefonundaki güncel kodu gir." };
  }

  const codes = generateRecoveryCodes();
  const db = getDb();

  db.exec("BEGIN");
  try {
    db.prepare("UPDATE users SET totp_enabled = 1 WHERE id = ?").run(userId);
    db.prepare("DELETE FROM recovery_codes WHERE user_id = ?").run(userId);
    const insert = db.prepare(
      "INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)",
    );
    for (const entry of codes) insert.run(userId, hashToken(normalizeRecoveryCode(entry)));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return { ok: true, recoveryCodes: codes };
}

export function disableTotp(userId: number): void {
  const db = getDb();
  db.prepare("UPDATE users SET totp_enabled = 0, totp_secret = '' WHERE id = ?").run(userId);
  db.prepare("DELETE FROM recovery_codes WHERE user_id = ?").run(userId);
}

export function regenerateRecoveryCodes(userId: number): string[] {
  const codes = generateRecoveryCodes();
  const db = getDb();

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM recovery_codes WHERE user_id = ?").run(userId);
    const insert = db.prepare("INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)");
    for (const entry of codes) insert.run(userId, hashToken(normalizeRecoveryCode(entry)));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return codes;
}

export function recoveryCodesLeft(userId: number): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL")
    .get(userId) as { n: number };
  return Number(row.n);
}

export type SecondFactor = "totp" | "recovery";

/**
 * İkinci adımı doğrular. Kurtarma kodu kabul edilirse TEK KULLANIMLIK olarak
 * işaretlenir — aksi halde bir kez sızan kod kalıcı arka kapı olurdu.
 */
export function verifySecondFactor(
  userId: number,
  code: string,
): { ok: true; via: SecondFactor } | { ok: false } {
  const { secret } = readSecret(userId);
  if (secret && verifyTotp(secret, code)) return { ok: true, via: "totp" };

  const normalized = normalizeRecoveryCode(code);
  if (normalized.length < 8) return { ok: false };

  const db = getDb();
  const row = db
    .prepare(
      "SELECT id FROM recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL",
    )
    .get(userId, hashToken(normalized)) as { id: number } | undefined;

  if (!row) return { ok: false };

  db.prepare("UPDATE recovery_codes SET used_at = unixepoch() WHERE id = ?").run(row.id);
  return { ok: true, via: "recovery" };
}

/* --- Giriş sırasındaki ikinci adım bileti --- */

export function createChallenge(
  userId: number,
  meta: { ip: string; userAgent: string },
): string {
  const token = generateToken(32);
  getDb()
    .prepare(
      `INSERT INTO login_challenges (token_hash, user_id, ip, user_agent, expires_at)
       VALUES (?, ?, ?, ?, unixepoch() + ?)`,
    )
    .run(hashToken(token), userId, meta.ip, meta.userAgent.slice(0, 300), CHALLENGE_TTL_SECONDS);
  return token;
}

export type ChallengeOutcome =
  | { ok: true; userId: number; via: SecondFactor }
  | { ok: false; error: string; expired?: boolean };

export function consumeChallenge(token: string, code: string): ChallengeOutcome {
  const db = getDb();
  const hash = hashToken(token);
  const row = db
    .prepare("SELECT user_id, attempts, expires_at FROM login_challenges WHERE token_hash = ?")
    .get(hash) as { user_id: number; attempts: number; expires_at: number } | undefined;

  if (!row) return { ok: false, error: "Doğrulama süresi doldu. Baştan giriş yap.", expired: true };

  if (Number(row.expires_at) < Math.floor(Date.now() / 1000)) {
    db.prepare("DELETE FROM login_challenges WHERE token_hash = ?").run(hash);
    return { ok: false, error: "Doğrulama süresi doldu. Baştan giriş yap.", expired: true };
  }

  if (Number(row.attempts) >= MAX_CHALLENGE_ATTEMPTS) {
    db.prepare("DELETE FROM login_challenges WHERE token_hash = ?").run(hash);
    return { ok: false, error: "Çok fazla hatalı kod. Baştan giriş yap.", expired: true };
  }

  const verified = verifySecondFactor(Number(row.user_id), code);
  if (!verified.ok) {
    db.prepare("UPDATE login_challenges SET attempts = attempts + 1 WHERE token_hash = ?").run(hash);
    return { ok: false, error: "Kod doğrulanamadı." };
  }

  db.prepare("DELETE FROM login_challenges WHERE token_hash = ?").run(hash);
  return { ok: true, userId: Number(row.user_id), via: verified.via };
}

export function pruneExpiredChallenges(): number {
  return Number(
    getDb().prepare("DELETE FROM login_challenges WHERE expires_at < unixepoch()").run().changes,
  );
}
