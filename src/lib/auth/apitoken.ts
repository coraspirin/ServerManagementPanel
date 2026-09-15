import "server-only";

import { getDb } from "@/lib/db/client";
import { generateToken, hashToken } from "@/lib/crypto";
import { getNumber } from "@/lib/settings";
import type { PermissionKey } from "./types";

/**
 * T12 — dış API bearer token'ları.
 *
 * Oturumlardan farkı üç noktada:
 *   1. Çerez yok, dolayısıyla CSRF de yok (kapı tarafında ele alınıyor).
 *   2. İzinler token'a yazılı ama her istekte sahibinin güncel izinleriyle
 *      KESİŞTİRİLİYOR — sebebi `resolveApiToken` üstünde.
 *   3. Uzun ömürlü, bu yüzden iptal ve son kullanım takibi birinci sınıf.
 */

/** Anahtarın tanınabilir öneki. */
const TOKEN_PREFIX = "pnl_";

/**
 * Listede gösterilen önek: "pnl_" + 8 karakter ≈ 48 bit.
 *
 * Ayırt etmeye fazlasıyla yeter, tahmine yaramaz — kalan ~208 bit
 * bilinmeyen kalır. Daha uzunu, log'a düşen her satırı anahtara bir adım
 * yaklaştırırdı; bu yüzden uzunluk bilerek kısa.
 */
const DISPLAY_PREFIX_LENGTH = TOKEN_PREFIX.length + 8;

export type ApiTokenIdentity = {
  tokenId: number;
  tokenName: string;
  prefix: string;
  userId: number;
  username: string;
  permissions: PermissionKey[];
};

export type ApiTokenRecord = {
  id: number;
  name: string;
  prefix: string;
  userId: number;
  username: string;
  permissions: PermissionKey[];
  kind: string;
  createdBy: string;
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
  lastUsedFrom: string;
  revokedAt: number | null;
};

type TokenRow = {
  id: number;
  name: string;
  prefix: string;
  user_id: number;
  permissions: string;
  kind: string;
  created_by: string;
  created_at: number;
  expires_at: number | null;
  last_used_at: number | null;
  last_used_from: string;
  revoked_at: number | null;
  username: string;
  must_change_pw: number;
  role_id: number;
};

function splitPermissions(raw: string): PermissionKey[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean) as PermissionKey[];
}

// Satırlar açıkça yeni nesnelere kopyalanıyor: node:sqlite null prototipli
// nesneler döndürüyor ve React bunları sunucudan istemciye geçiremiyor
// (users.ts'teki listPermissions ile aynı gerekçe).
function toRecord(row: TokenRow): ApiTokenRecord {
  return {
    id: Number(row.id),
    name: String(row.name),
    prefix: String(row.prefix),
    userId: Number(row.user_id),
    username: String(row.username),
    permissions: splitPermissions(String(row.permissions)),
    kind: String(row.kind),
    createdBy: String(row.created_by),
    createdAt: Number(row.created_at),
    expiresAt: row.expires_at === null ? null : Number(row.expires_at),
    lastUsedAt: row.last_used_at === null ? null : Number(row.last_used_at),
    lastUsedFrom: String(row.last_used_from),
    revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
  };
}

/**
 * Kullanıcının rolünden gelen güncel izinler.
 *
 * session.ts'teki `loadPermissions` ile aynı sorgu; oradan içe aktarılmadı
 * çünkü o modül `cookies()` kullanıyor ve token yolunu gereksiz yere oturum
 * altyapısına bağlardı.
 */
function rolePermissions(roleId: number): Set<string> {
  return new Set(
    (
      getDb()
        .prepare("SELECT permission_key FROM role_permissions WHERE role_id = ?")
        .all(roleId) as { permission_key: string }[]
    ).map((row) => row.permission_key),
  );
}

export type CreateTokenInput = {
  name: string;
  userId: number;
  username: string;
  permissions: PermissionKey[];
  /** null veya 0 = süresiz. */
  expiresInDays: number | null;
  kind?: "manual" | "device";
  deviceId?: string;
};

/** Aktif (iptal edilmemiş) anahtar sayısı — üst sınır kontrolü için. */
export function activeTokenCount(userId: number): number {
  return Number(
    (
      getDb()
        .prepare("SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL")
        .get(userId) as { n: number }
    ).n,
  );
}

/**
 * Yeni anahtar üretir. Düz değer YALNIZCA burada döner ve bir daha
 * üretilemez — saklanan tek şey sha256 özeti. Kaybedilirse yenisi üretilir,
 * "hatırlatma" diye bir şey olamaz.
 */
export function createApiToken(input: CreateTokenInput): { token: string; id: number } {
  const token = TOKEN_PREFIX + generateToken(32);
  const expiresAt =
    input.expiresInDays === null || input.expiresInDays <= 0
      ? null
      : Math.floor(Date.now() / 1000) + input.expiresInDays * 86400;

  const info = getDb()
    .prepare(
      `INSERT INTO api_tokens
         (name, prefix, token_hash, user_id, permissions, kind, device_id, created_by, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.name,
      token.slice(0, DISPLAY_PREFIX_LENGTH),
      hashToken(token),
      input.userId,
      input.permissions.join(","),
      input.kind ?? "manual",
      input.deviceId ?? null,
      input.username,
      expiresAt,
    );

  return { token, id: Number(info.lastInsertRowid) };
}

/** `userId` verilmezse tüm kullanıcıların anahtarları (yalnızca yönetici). */
export function listApiTokens(options: { userId?: number } = {}): ApiTokenRecord[] {
  const userId = options.userId;
  const rows = userId !== undefined
    ? getDb()
        .prepare(
          `SELECT t.*, u.username, u.must_change_pw, u.role_id
           FROM api_tokens t JOIN users u ON u.id = t.user_id
           WHERE t.user_id = ?
           ORDER BY t.revoked_at IS NOT NULL, t.created_at DESC`,
        )
        .all(userId)
    : getDb()
        .prepare(
          `SELECT t.*, u.username, u.must_change_pw, u.role_id
           FROM api_tokens t JOIN users u ON u.id = t.user_id
           ORDER BY t.revoked_at IS NOT NULL, t.created_at DESC`,
        )
        .all();

  return (rows as TokenRow[]).map(toRecord);
}

export function findApiToken(id: number): ApiTokenRecord | null {
  const row = getDb()
    .prepare(
      `SELECT t.*, u.username, u.must_change_pw, u.role_id
       FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.id = ?`,
    )
    .get(id) as TokenRow | undefined;
  return row ? toRecord(row) : null;
}

/** İptal — satır SİLİNMEZ, damgalanır. "Ne zaman kapandı" sorusu cevapsız kalmasın. */
export function revokeApiToken(id: number): boolean {
  return (
    Number(
      getDb()
        .prepare(
          "UPDATE api_tokens SET revoked_at = unixepoch() WHERE id = ? AND revoked_at IS NULL",
        )
        .run(id).changes,
    ) > 0
  );
}

/**
 * İptal/süre dolumunun üzerinden saklama süresi geçmiş satırları siler.
 *
 * İptal satırları bilerek saklandığı ve aktif sınırı onları saymadığı için
 * tablonun başka tavanı yok. `pruneAudit` ile aynı sözleşme: 0 = hiç silme.
 */
export function pruneApiTokens(retentionDays: number): number {
  if (retentionDays <= 0) return 0;
  const cutoff = retentionDays * 86400;
  return Number(
    getDb()
      .prepare(
        `DELETE FROM api_tokens
         WHERE (revoked_at IS NOT NULL AND revoked_at < unixepoch() - ?)
            OR (expires_at IS NOT NULL AND expires_at < unixepoch() - ?)`,
      )
      .run(cutoff, cutoff).changes,
  );
}

export type ResolveFailure =
  | "unknown"
  | "revoked"
  | "expired"
  | "inactive"
  | "must_change_password";

export type ResolveResult =
  | { ok: true; identity: ApiTokenIdentity }
  | { ok: false; reason: ResolveFailure };

/**
 * Ham bearer değerinden kimliği çözer.
 *
 * ⚠️ KESİŞİM SATIRI KRİTİK. Bir rolün izinleri değiştiğinde oturumlar
 * `destroyAllSessionsForUser` ile düşürülüyor; token'da düşürülecek bir oturum
 * yok. Kesişim her istekte alınmasaydı, izni geri alınmış bir kullanıcının
 * anahtarı eski geniş yetkisiyle çalışmaya devam eder ve bunu hiçbir ekran
 * göstermezdi. Yani `permissions` sütunu bir ÜST SINIR, yetkinin kendisi değil.
 *
 * Başarısızlık sebebi ayrıştırılıyor ama DIŞARI VERİLMİYOR (guard hepsini
 * aynı 401'e çeviriyor): "bu anahtar iptal edilmiş" ile "böyle bir anahtar
 * yok" arasındaki fark, tarama yapan birine bilgi olurdu. Ayrım yalnızca
 * sunucu tarafı log ve audit için.
 */
export function resolveApiToken(raw: string): ResolveResult {
  if (!raw.startsWith(TOKEN_PREFIX)) return { ok: false, reason: "unknown" };

  const row = getDb()
    .prepare(
      `SELECT t.*, u.username, u.must_change_pw, u.role_id, u.is_active
       FROM api_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = ?`,
    )
    .get(hashToken(raw)) as (TokenRow & { is_active: number }) | undefined;

  if (!row) return { ok: false, reason: "unknown" };
  if (row.revoked_at !== null) return { ok: false, reason: "revoked" };
  if (row.expires_at !== null && Number(row.expires_at) < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "expired" };
  }
  if (Number(row.is_active) !== 1) return { ok: false, reason: "inactive" };
  // Oturum tarafında kullanıcı /login/parola'ya zorlanıyor. Token tarafında
  // karşılığı olmasaydı, parolası sıfırlanmış bir hesabın anahtarı hiçbir şey
  // olmamış gibi çalışırdı — oysa parola sıfırlama çoğu zaman "bu hesap
  // tehlikede" demektir.
  if (Number(row.must_change_pw) === 1) return { ok: false, reason: "must_change_password" };

  const current = rolePermissions(Number(row.role_id));
  const granted = splitPermissions(String(row.permissions)).filter((key) => current.has(key));

  return {
    ok: true,
    identity: {
      tokenId: Number(row.id),
      tokenName: String(row.name),
      prefix: String(row.prefix),
      userId: Number(row.user_id),
      username: String(row.username),
      permissions: granted,
    },
  };
}

/**
 * Son kullanım damgası — KISILMIŞ.
 *
 * `resolveSession` her istekte `last_seen_at` yazıyor; tarayıcı trafiğinde bu
 * sorun değil. Token trafiği başka: 15 saniyede bir scrape eden bir Prometheus
 * günde ~5.760 gereksiz UPDATE demek — WAL'i şişiren, hiçbir soruya yeni cevap
 * vermeyen yazma. 60 saniyelik çözünürlük "bu anahtar hâlâ kullanımda mı,
 * en son ne zaman ve nereden" sorusunu fazlasıyla karşılıyor.
 *
 * İSTİSNA: IP değiştiyse eşik beklenmez. Anahtarın yeni bir yerden
 * kullanılmaya başlaması, tam da kaçırılmaması gereken sinyal.
 */
export function touchApiToken(tokenId: number, ip: string): void {
  const row = getDb()
    .prepare("SELECT last_used_at, last_used_from FROM api_tokens WHERE id = ?")
    .get(tokenId) as { last_used_at: number | null; last_used_from: string } | undefined;
  if (!row) return;

  const now = Math.floor(Date.now() / 1000);
  const interval = getNumber("api.last_used_write_interval");
  const stale = row.last_used_at === null || now - Number(row.last_used_at) >= interval;
  const moved = String(row.last_used_from) !== ip;

  if (!stale && !moved) return;

  getDb()
    .prepare("UPDATE api_tokens SET last_used_at = ?, last_used_from = ? WHERE id = ?")
    .run(now, ip.slice(0, 100), tokenId);
}
