import "server-only";

import { getDb } from "@/lib/db/client";
import { generateToken, hashToken } from "@/lib/crypto";

/**
 * M2.7 — kiosk erişim bağlantıları.
 *
 * Duvara asılı bir tablet için oturum açmak işe yaramıyor: cihaz aylarca açık
 * kalır, oturum süresi dolar ve ekran bir gün sessizce giriş sayfasına döner.
 * Adresin içinde taşınan token bunu çözüyor.
 *
 * ⚠️ Token adresin içinde yolculuk ediyor; tarayıcı geçmişine ve proxy
 *    loglarına düşer. Bu yüzden verdiği yetki BİLEREK en dar hali: yalnızca
 *    kiosk görünümünü okumak. Yazan hiçbir uç bu yolu kabul etmez ve token
 *    hiçbir oturum kurmaz.
 */

export type KioskToken = {
  name: string;
  createdAt: number;
  createdBy: string;
  lastSeenAt: number | null;
  expiresAt: number | null;
};

type Row = {
  token_hash: string;
  name: string;
  created_at: number;
  created_by: string;
  last_seen_at: number | null;
  expires_at: number | null;
};

/** Listede ayırt edilebilsin diye özetin ilk karakterleri; token'ın kendisi DEĞİL. */
export type KioskTokenView = KioskToken & { fingerprint: string };

function toView(row: Row): KioskTokenView {
  return {
    name: row.name,
    createdAt: row.created_at,
    createdBy: row.created_by,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    fingerprint: row.token_hash.slice(0, 8),
  };
}

export function listKioskTokens(): KioskTokenView[] {
  return (
    getDb().prepare("SELECT * FROM kiosk_tokens ORDER BY created_at DESC").all() as Row[]
  ).map(toView);
}

/**
 * Yeni token üretir. Düz değer YALNIZCA burada, bir kez döner — sonra
 * yalnızca özeti saklandığı için bir daha gösterilemez.
 */
export function createKioskToken(
  name: string,
  createdBy: string,
  expiresAt: number | null,
): string {
  const token = generateToken(24);
  getDb()
    .prepare(
      "INSERT INTO kiosk_tokens (token_hash, name, created_by, expires_at) VALUES (?, ?, ?, ?)",
    )
    .run(hashToken(token), name.trim(), createdBy, expiresAt);
  return token;
}

export function revokeKioskToken(fingerprint: string): boolean {
  const changes = getDb()
    .prepare("DELETE FROM kiosk_tokens WHERE substr(token_hash, 1, 8) = ?")
    .run(fingerprint).changes;
  return Number(changes) > 0;
}

/**
 * Token geçerli mi. Geçerliyse "son görülme" güncellenir — kullanıcı hangi
 * bağlantının hâlâ kullanıldığını görüp gerisini iptal edebilsin.
 */
export function verifyKioskToken(token: string): boolean {
  const hash = hashToken(token);
  const row = getDb()
    .prepare("SELECT expires_at FROM kiosk_tokens WHERE token_hash = ?")
    .get(hash) as { expires_at: number | null } | undefined;

  if (!row) return false;

  const now = Math.floor(Date.now() / 1000);
  if (row.expires_at !== null && row.expires_at < now) return false;

  getDb().prepare("UPDATE kiosk_tokens SET last_seen_at = ? WHERE token_hash = ?").run(now, hash);
  return true;
}
