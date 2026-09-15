import type { Migration } from "./types";

/**
 * M3.1 — kullanıcı/rol yönetimi UI'ının ihtiyaç duyduğu şema + 2FA.
 *
 * Faz 3'ün TÜM izinleri burada bir kerede tanımlanıyor. Her milestone kendi
 * iznini ayrı migration'la eklerse rol düzenleme ekranı faz boyunca eksik
 * görünür ve kullanıcı "izin listesi neden büyüyor" diye sorar. İzin var ama
 * ekranı yoksa zararsız: hiçbir uç onu henüz kontrol etmiyor.
 *
 * TOTP sırrı `users.totp_secret` içinde T3 ile şifreli duruyor (settings'teki
 * secret'larla aynı biçim). Kurtarma kodları ise geri okunmaz — yalnızca
 * sha256 özetleri saklanır, tıpkı oturum token'ları gibi.
 */
export const migration013: Migration = {
  version: 13,
  name: "users_2fa",
  up: `
ALTER TABLE users ADD COLUMN totp_secret  TEXT    NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;

CREATE TABLE recovery_codes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT    NOT NULL,
  used_at   INTEGER
);

CREATE INDEX idx_recovery_user ON recovery_codes(user_id);

-- Parola doğru ama ikinci adım bekleniyor. Oturum HENÜZ yok: bu satır
-- "parolayı bilen biri şu anda giriş yapmaya çalışıyor" demektir, yetki değil.
CREATE TABLE login_challenges (
  token_hash TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip         TEXT    NOT NULL DEFAULT '',
  user_agent TEXT    NOT NULL DEFAULT '',
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX idx_challenges_expires ON login_challenges(expires_at);

INSERT INTO permissions (key, description) VALUES
  ('logs.view',          'Merkezi log aramasını kullanma'),
  ('backup.manage',      'Yedekleme işlerini tanımlama ve geri yükleme'),
  ('files.read',         'Dosya yöneticisinde gözatma ve indirme'),
  ('files.write',        'Dosya yükleme, düzenleme, silme ve izin değiştirme'),
  ('db.read',            'Veritabanı yöneticisinde gözatma ve SELECT'),
  ('db.write',           'Veritabanında veri/şema değiştiren sorgu çalıştırma'),
  ('security.view',      'Firewall, fail2ban ve güvenlik taraması sonuçlarını görme'),
  ('security.manage',    'Firewall kuralı ve güvenlik ayarlarını değiştirme'),
  ('cron.manage',        'Host zamanlanmış görevlerini yönetme'),
  ('apps.install',       'Şablon katalogundan yeni yığın kurma'),
  ('automation.manage',  'Otomasyon kuralları, webhook ve API token yönetimi'),
  ('repos.manage',       'Git depolarını senkronlama ve GitOps ayarları'),
  ('vault.view',         'Şifre kasası durumunu görme ve kasaya erişme');

-- admin rolü tanım gereği her şeyi yapar; yeni izinler otomatik ona geçer.
INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT 1, key FROM permissions;
`,
};
