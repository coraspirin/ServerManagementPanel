import "server-only";

import { getDb } from "@/lib/db/client";
import { hashPassword, hashToken } from "@/lib/crypto";
import { destroyAllSessionsForUser } from "./session";
import type { PermissionKey } from "./types";

/**
 * M3.1 — kullanıcı ve rol yönetimi.
 *
 * KORUMA KURALI: panel kendini yönetilemez hâle sokamamalı. Son admin'i
 * silmek, pasifleştirmek, rolünü düşürmek ya da admin rolünden `users.manage`
 * iznini almak — hepsi burada reddediliyor. Bu kontroller UI'da değil burada:
 * API doğrudan da çağrılabilir ve o yolda da kilitlenme olmamalı.
 */

export type ManagedUser = {
  id: number;
  username: string;
  displayName: string;
  roleId: number;
  roleName: string;
  isActive: boolean;
  mustChangePassword: boolean;
  totpEnabled: boolean;
  failedAttempts: number;
  lockedUntil: number | null;
  /** Kilit ŞU AN geçerli mi — kararı sunucu veriyor, istemci saatine güvenilmez. */
  locked: boolean;
  lastLoginAt: number | null;
  createdAt: number;
  activeSessions: number;
  /** Kullanılmamış kurtarma kodu sayısı — 0 ise 2FA'nın çıkış kapısı yok. */
  recoveryLeft: number;
};

export type ManagedRole = {
  id: number;
  name: string;
  description: string;
  isSystem: boolean;
  userCount: number;
  permissions: PermissionKey[];
};

export type PermissionInfo = { key: PermissionKey; description: string };

export type UserSession = {
  id: string;
  userId: number;
  username: string;
  ip: string;
  userAgent: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  current: boolean;
};

type Fail = { ok: false; error: string };
type Done<T> = { ok: true; result: T };
export type Outcome<T> = Done<T> | Fail;

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/i;

/** Parola kuralı tek yerde: hem oluşturma hem sıfırlama aynı eşiği görsün. */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return "Parola en az 10 karakter olmalı.";
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    return "Parola en az bir harf ve bir rakam içermeli.";
  }
  return null;
}

export function listUsers(): ManagedUser[] {
  return (
    getDb()
      .prepare(
        `SELECT u.id, u.username, u.display_name, u.role_id, u.is_active,
                u.must_change_pw, u.totp_enabled, u.failed_attempts, u.locked_until,
                u.last_login_at, u.created_at, r.name AS role_name,
                (u.locked_until IS NOT NULL AND u.locked_until > unixepoch()) AS locked,
                (SELECT COUNT(*) FROM sessions s
                  WHERE s.user_id = u.id AND s.expires_at > unixepoch()) AS sessions,
                (SELECT COUNT(*) FROM recovery_codes c
                  WHERE c.user_id = u.id AND c.used_at IS NULL) AS recovery_left
         FROM users u JOIN roles r ON r.id = u.role_id
         ORDER BY u.username COLLATE NOCASE`,
      )
      .all() as Record<string, number | string | null>[]
  ).map((row) => ({
    id: Number(row.id),
    username: String(row.username),
    displayName: String(row.display_name) || String(row.username),
    roleId: Number(row.role_id),
    roleName: String(row.role_name),
    isActive: Number(row.is_active) === 1,
    mustChangePassword: Number(row.must_change_pw) === 1,
    totpEnabled: Number(row.totp_enabled) === 1,
    failedAttempts: Number(row.failed_attempts),
    lockedUntil: row.locked_until === null ? null : Number(row.locked_until),
    locked: Number(row.locked) === 1,
    lastLoginAt: row.last_login_at === null ? null : Number(row.last_login_at),
    createdAt: Number(row.created_at),
    activeSessions: Number(row.sessions),
    recoveryLeft: Number(row.recovery_left),
  }));
}

export function listRoles(): ManagedRole[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT r.id, r.name, r.description, r.is_system,
              (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count
       FROM roles r ORDER BY r.is_system DESC, r.name COLLATE NOCASE`,
    )
    .all() as Record<string, number | string>[];

  const grants = db
    .prepare("SELECT role_id, permission_key FROM role_permissions")
    .all() as { role_id: number; permission_key: PermissionKey }[];

  return rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    description: String(row.description),
    isSystem: Number(row.is_system) === 1,
    userCount: Number(row.user_count),
    permissions: grants
      .filter((grant) => Number(grant.role_id) === Number(row.id))
      .map((grant) => grant.permission_key),
  }));
}

/**
 * Karşılığı olan hiçbir ekran kalmayan izinler (M3.16).
 *
 * `vault.view` ve `repos.manage` migration 013'te, Faz 3'ün tüm izinleri bir
 * kerede tanımlanırken açılmıştı; M3.15 ve M3.14 sonradan kapsam dışına
 * çıkarıldı. Satırları SİLİNMİYOR — şema sunucuda kurulu ve bir migration'ı
 * geriye dönük değiştirmek, aynı şemayı farklı yollardan üretilmiş iki
 * veritabanı demek olurdu. Bunun yerine rol düzenleme ekranında
 * gösterilmiyorlar: hiçbir şey açmayan bir izni listede tutmak, kullanıcıya
 * var olmayan bir yetki veriyormuş gibi görünürdü.
 */
const RETIRED_PERMISSIONS = new Set<string>(["vault.view", "repos.manage"]);

export function listPermissions(): PermissionInfo[] {
  // Satırlar açıkça yeni nesnelere kopyalanıyor: node:sqlite null prototipli
  // nesneler döndürüyor ve React bunları sunucudan istemciye geçiremiyor
  // ("Only plain objects... can be passed to Client Components").
  return (
    getDb().prepare("SELECT key, description FROM permissions ORDER BY key").all() as {
      key: PermissionKey;
      description: string;
    }[]
  )
    .filter((row) => !RETIRED_PERMISSIONS.has(row.key))
    .map((row) => ({ key: row.key, description: String(row.description) }));
}

export function listSessions(currentToken: string | null): UserSession[] {
  const currentHash = currentToken ? hashToken(currentToken) : null;
  return (
    getDb()
      .prepare(
        `SELECT s.token_hash, s.user_id, s.ip, s.user_agent,
                s.created_at, s.last_seen_at, s.expires_at, u.username
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.expires_at > unixepoch()
         ORDER BY s.last_seen_at DESC`,
      )
      .all() as Record<string, string | number>[]
  ).map((row) => ({
    id: String(row.token_hash),
    userId: Number(row.user_id),
    username: String(row.username),
    ip: String(row.ip),
    userAgent: String(row.user_agent),
    createdAt: Number(row.created_at),
    lastSeenAt: Number(row.last_seen_at),
    expiresAt: Number(row.expires_at),
    current: currentHash !== null && String(row.token_hash) === currentHash,
  }));
}

/**
 * "users.manage" iznine sahip, aktif kullanıcı sayısı. Bir işlem bu sayıyı
 * sıfıra düşürecekse reddedilir — aksi halde panele kimse giremez ve tek
 * çare veritabanını elle açmak olur.
 */
function adminCount(excludingUserId?: number): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM users u
       WHERE u.is_active = 1
         AND u.id <> COALESCE(?, -1)
         AND EXISTS (SELECT 1 FROM role_permissions rp
                     WHERE rp.role_id = u.role_id AND rp.permission_key = 'users.manage')`,
    )
    .get(excludingUserId ?? null) as { n: number };
  return Number(row.n);
}

function roleGrantsManage(roleId: number): boolean {
  const row = getDb()
    .prepare(
      "SELECT 1 AS ok FROM role_permissions WHERE role_id = ? AND permission_key = 'users.manage'",
    )
    .get(roleId) as { ok: number } | undefined;
  return row !== undefined;
}

export function createUser(input: {
  username: string;
  displayName: string;
  password: string;
  roleId: number;
  mustChangePassword: boolean;
}): Outcome<ManagedUser> {
  const username = input.username.trim();
  if (!USERNAME_RE.test(username)) {
    return {
      ok: false,
      error: "Kullanıcı adı 2-32 karakter olmalı; harf/rakam ile başlayıp . _ - içerebilir.",
    };
  }

  const problem = passwordProblem(input.password);
  if (problem) return { ok: false, error: problem };

  const db = getDb();
  const role = db.prepare("SELECT id FROM roles WHERE id = ?").get(input.roleId);
  if (!role) return { ok: false, error: "Rol bulunamadı." };

  const clash = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (clash) return { ok: false, error: "Bu kullanıcı adı zaten var." };

  const info = db
    .prepare(
      `INSERT INTO users (username, display_name, password_hash, role_id, must_change_pw)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      username,
      input.displayName.trim(),
      hashPassword(input.password),
      input.roleId,
      input.mustChangePassword ? 1 : 0,
    );

  const created = listUsers().find((user) => user.id === Number(info.lastInsertRowid));
  return created ? { ok: true, result: created } : { ok: false, error: "Kullanıcı okunamadı." };
}

export function updateUser(
  id: number,
  input: { displayName?: string; roleId?: number; isActive?: boolean },
): Outcome<ManagedUser> {
  const db = getDb();
  const user = db.prepare("SELECT id, role_id, is_active FROM users WHERE id = ?").get(id) as
    | { id: number; role_id: number; is_active: number }
    | undefined;
  if (!user) return { ok: false, error: "Kullanıcı bulunamadı." };

  const nextRoleId = input.roleId ?? Number(user.role_id);
  const nextActive = input.isActive ?? Number(user.is_active) === 1;

  if (input.roleId !== undefined && !db.prepare("SELECT id FROM roles WHERE id = ?").get(input.roleId)) {
    return { ok: false, error: "Rol bulunamadı." };
  }

  // Bu kullanıcı değişiklikten sonra hâlâ admin sayılacak mı?
  const staysAdmin = nextActive && roleGrantsManage(nextRoleId);
  if (!staysAdmin && adminCount(id) === 0) {
    return {
      ok: false,
      error:
        "Bu, kullanıcı yönetimi yetkisi olan tek aktif hesap. Rolünü düşürmek ya da " +
        "pasifleştirmek paneli yönetilemez hâle getirirdi.",
    };
  }

  db.prepare(
    `UPDATE users
     SET display_name = COALESCE(?, display_name),
         role_id = ?,
         is_active = ?
     WHERE id = ?`,
  ).run(input.displayName?.trim() ?? null, nextRoleId, nextActive ? 1 : 0, id);

  // Pasifleştirilen ya da rolü değişen kullanıcının açık oturumları eski
  // yetkiyi taşımaya devam etmemeli.
  if (!nextActive || nextRoleId !== Number(user.role_id)) destroyAllSessionsForUser(id);

  const updated = listUsers().find((entry) => entry.id === id);
  return updated ? { ok: true, result: updated } : { ok: false, error: "Kullanıcı okunamadı." };
}

export function deleteUser(id: number): Outcome<{ id: number }> {
  const db = getDb();
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
  if (!user) return { ok: false, error: "Kullanıcı bulunamadı." };

  if (adminCount(id) === 0) {
    return {
      ok: false,
      error: "Kullanıcı yönetimi yetkisi olan son aktif hesap silinemez.",
    };
  }

  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  return { ok: true, result: { id } };
}

export function resetPassword(
  id: number,
  password: string,
  mustChange: boolean,
): Outcome<{ id: number }> {
  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: problem };

  const info = getDb()
    .prepare(
      `UPDATE users
       SET password_hash = ?, must_change_pw = ?, failed_attempts = 0, locked_until = NULL
       WHERE id = ?`,
    )
    .run(hashPassword(password), mustChange ? 1 : 0, id);

  if (Number(info.changes) === 0) return { ok: false, error: "Kullanıcı bulunamadı." };

  // Parolayı yönetici sıfırladıysa eski oturumlar da kapanmalı: sıfırlama
  // sebebi genelde "hesap ele geçti" olur.
  destroyAllSessionsForUser(id);
  return { ok: true, result: { id } };
}

export function unlockUser(id: number): Outcome<{ id: number }> {
  const info = getDb()
    .prepare("UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?")
    .run(id);
  return Number(info.changes) > 0
    ? { ok: true, result: { id } }
    : { ok: false, error: "Kullanıcı bulunamadı." };
}

/** 2FA'yı yönetici kapatır: telefonunu kaybeden kullanıcının tek kurtuluşu. */
export function disableTotpFor(id: number): Outcome<{ id: number }> {
  const db = getDb();
  const info = db
    .prepare("UPDATE users SET totp_enabled = 0, totp_secret = '' WHERE id = ?")
    .run(id);
  if (Number(info.changes) === 0) return { ok: false, error: "Kullanıcı bulunamadı." };
  db.prepare("DELETE FROM recovery_codes WHERE user_id = ?").run(id);
  return { ok: true, result: { id } };
}

export function revokeSession(tokenHash: string): boolean {
  return (
    Number(getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash).changes) > 0
  );
}

const ROLE_NAME_RE = /^[a-zçğıöşü0-9][a-zçğıöşü0-9 ._-]{1,31}$/i;

export function createRole(input: {
  name: string;
  description: string;
  permissions: string[];
}): Outcome<ManagedRole> {
  const name = input.name.trim();
  if (!ROLE_NAME_RE.test(name)) return { ok: false, error: "Rol adı 2-32 karakter olmalı." };

  const db = getDb();
  if (db.prepare("SELECT id FROM roles WHERE name = ?").get(name)) {
    return { ok: false, error: "Bu rol adı zaten var." };
  }

  const info = db
    .prepare("INSERT INTO roles (name, description, is_system) VALUES (?, ?, 0)")
    .run(name, input.description.trim());
  const roleId = Number(info.lastInsertRowid);

  applyPermissions(roleId, input.permissions);

  const created = listRoles().find((role) => role.id === roleId);
  return created ? { ok: true, result: created } : { ok: false, error: "Rol okunamadı." };
}

function applyPermissions(roleId: number, permissions: string[]): void {
  const db = getDb();
  // `listPermissions()` emekli izinleri elemiş durumda; bu, rol bir kez
  // düzenlendiğinde eski `vault.view`/`repos.manage` yetkilerinin de
  // temizlenmesi demek. İstenen davranış: hiçbir şey açmayan bir yetkinin
  // rolde asılı kalmasının bir faydası yok.
  const known = new Set(listPermissions().map((permission) => permission.key));

  db.prepare("DELETE FROM role_permissions WHERE role_id = ?").run(roleId);
  const insert = db.prepare(
    "INSERT OR IGNORE INTO role_permissions (role_id, permission_key) VALUES (?, ?)",
  );
  for (const key of permissions) {
    if (known.has(key as PermissionKey)) insert.run(roleId, key);
  }
}

export function updateRole(
  id: number,
  input: { name?: string; description?: string; permissions?: string[] },
): Outcome<ManagedRole> {
  const db = getDb();
  const role = db.prepare("SELECT id, name, is_system FROM roles WHERE id = ?").get(id) as
    | { id: number; name: string; is_system: number }
    | undefined;
  if (!role) return { ok: false, error: "Rol bulunamadı." };

  if (input.name !== undefined && Number(role.is_system) === 1 && input.name.trim() !== role.name) {
    return { ok: false, error: "Sistem rolünün adı değiştirilemez; izinleri düzenlenebilir." };
  }

  if (input.permissions !== undefined) {
    // Rolden `users.manage` çıkarılıyorsa: bu rolü kullanan admin'ler düşer.
    // Sonuç sıfır admin ise işlem yapılmadan reddedilir.
    const losesManage = !input.permissions.includes("users.manage");
    if (losesManage && roleGrantsManage(id)) {
      const others = db
        .prepare(
          `SELECT COUNT(*) AS n FROM users u
           WHERE u.is_active = 1 AND u.role_id <> ?
             AND EXISTS (SELECT 1 FROM role_permissions rp
                         WHERE rp.role_id = u.role_id AND rp.permission_key = 'users.manage')`,
        )
        .get(id) as { n: number };
      if (Number(others.n) === 0) {
        return {
          ok: false,
          error:
            "Bu rol, kullanıcı yönetimi yetkisi kalan tek rol. İzni kaldırmak paneli " +
            "yönetilemez hâle getirirdi.",
        };
      }
    }
  }

  if (input.name !== undefined || input.description !== undefined) {
    db.prepare(
      "UPDATE roles SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?",
    ).run(input.name?.trim() ?? null, input.description?.trim() ?? null, id);
  }

  if (input.permissions !== undefined) {
    applyPermissions(id, input.permissions);
    // İzin kümesi değişti: bu rolü taşıyan açık oturumlar eski izinleri
    // bellekte tutuyor olabilir, hepsi yeniden giriş yapmalı.
    for (const row of db.prepare("SELECT id FROM users WHERE role_id = ?").all(id) as {
      id: number;
    }[]) {
      destroyAllSessionsForUser(Number(row.id));
    }
  }

  const updated = listRoles().find((entry) => entry.id === id);
  return updated ? { ok: true, result: updated } : { ok: false, error: "Rol okunamadı." };
}

export function deleteRole(id: number): Outcome<{ id: number }> {
  const db = getDb();
  const role = db.prepare("SELECT id, is_system FROM roles WHERE id = ?").get(id) as
    | { id: number; is_system: number }
    | undefined;
  if (!role) return { ok: false, error: "Rol bulunamadı." };
  if (Number(role.is_system) === 1) return { ok: false, error: "Sistem rolü silinemez." };

  const users = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role_id = ?").get(id) as {
    n: number;
  };
  if (Number(users.n) > 0) {
    return {
      ok: false,
      error: `Bu rolü ${users.n} kullanıcı kullanıyor. Önce onları başka bir role taşı.`,
    };
  }

  db.prepare("DELETE FROM roles WHERE id = ?").run(id);
  return { ok: true, result: { id } };
}
