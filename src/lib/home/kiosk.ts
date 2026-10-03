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
  const db = getDb();
  // Düzen satırları açıkça siliniyor: ON DELETE CASCADE yalnızca bağlantıda
  // `foreign_keys` açıksa çalışır; ona güvenmek yerine iz bırakmamak yeğ.
  db.prepare("DELETE FROM kiosk_widgets WHERE substr(token_hash, 1, 8) = ?").run(fingerprint);
  const changes = db
    .prepare("DELETE FROM kiosk_tokens WHERE substr(token_hash, 1, 8) = ?")
    .run(fingerprint).changes;
  return Number(changes) > 0;
}

/**
 * Yönetim ekranı için: özetin ilk karakterlerinden kaydın kendisi.
 * Arayüz düz token'ı hiç görmediği için bağlantıları bununla tanıyor
 * (iptal ile aynı eşleşme).
 */
export function kioskByFingerprint(fingerprint: string): (KioskTokenView & { tokenHash: string }) | null {
  if (!/^[0-9a-f]{8}$/.test(fingerprint)) return null;
  const row = getDb()
    .prepare("SELECT * FROM kiosk_tokens WHERE substr(token_hash, 1, 8) = ?")
    .get(fingerprint) as Row | undefined;
  return row ? { ...toView(row), tokenHash: row.token_hash } : null;
}

/** Ad ve geçerlilik süresi. `expiresAt: null` = süresiz. */
export function updateKioskToken(
  tokenHash: string,
  patch: { name?: string; expiresAt?: number | null },
): void {
  const db = getDb();
  if (patch.name !== undefined) {
    db.prepare("UPDATE kiosk_tokens SET name = ? WHERE token_hash = ?").run(patch.name.trim(), tokenHash);
  }
  if (patch.expiresAt !== undefined) {
    db.prepare("UPDATE kiosk_tokens SET expires_at = ? WHERE token_hash = ?").run(patch.expiresAt, tokenHash);
  }
}

/**
 * Token geçerliyse onu oluşturan kullanıcının adı, değilse null. Geçerliyse
 * "son görülme" güncellenir — kullanıcı hangi bağlantının hâlâ kullanıldığını
 * görüp gerisini iptal edebilsin.
 *
 * Sahip, kiosk ekranının HANGİ panoyu göstereceğini belirliyor; token yine de
 * hiçbir oturum kurmuyor ve hiçbir yazan uç onu kabul etmiyor.
 */
export function kioskTokenOwner(token: string): { owner: string; tokenHash: string } | null {
  const hash = hashToken(token);
  const row = getDb()
    .prepare("SELECT expires_at, created_by FROM kiosk_tokens WHERE token_hash = ?")
    .get(hash) as { expires_at: number | null; created_by: string } | undefined;

  if (!row) return null;

  const now = Math.floor(Date.now() / 1000);
  if (row.expires_at !== null && row.expires_at < now) return null;

  getDb().prepare("UPDATE kiosk_tokens SET last_seen_at = ? WHERE token_hash = ?").run(now, hash);
  return { owner: row.created_by, tokenHash: hash };
}
