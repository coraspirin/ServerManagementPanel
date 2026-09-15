import type { Migration } from "./types";

/**
 * M0.4 — auth çekirdeği: kullanıcı, rol/izin, oturum, audit.
 *
 * Roller sabit üçlü değil: `permissions` + `role_permissions` ile modellendi,
 * böylece M3.1'deki "özel rol" UI'ı şema değişikliği gerektirmez. admin /
 * kullanici / izleyici hazır rol olarak tohumlanır.
 */
export const migration002: Migration = {
  version: 2,
  name: "auth",
  up: `
CREATE TABLE roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  description TEXT    NOT NULL DEFAULT '',
  -- Sistem rolleri silinemez; yalnızca izinleri düzenlenebilir.
  is_system   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE permissions (
  key         TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE role_permissions (
  role_id        INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key TEXT    NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
) WITHOUT ROWID;

CREATE TABLE users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  display_name    TEXT    NOT NULL DEFAULT '',
  password_hash   TEXT    NOT NULL,
  role_id         INTEGER NOT NULL REFERENCES roles(id),
  is_active       INTEGER NOT NULL DEFAULT 1,
  -- Parola ilk girişte değiştirilmeli mi (bootstrap admin için 1).
  must_change_pw  INTEGER NOT NULL DEFAULT 0,
  -- T6: kaba kuvvet koruması
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    INTEGER,
  last_login_at   INTEGER,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE sessions (
  -- Token düz tutulmaz, yalnızca sha256 özeti (DB sızarsa oturum ele geçmesin).
  token_hash   TEXT    PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token   TEXT    NOT NULL,
  ip           TEXT    NOT NULL DEFAULT '',
  user_agent   TEXT    NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at   INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id     INTEGER NOT NULL DEFAULT 1 REFERENCES hosts(id) ON DELETE CASCADE,
  ts          INTEGER NOT NULL DEFAULT (unixepoch()),
  -- Kullanıcı silinse de kayıt anlamlı kalsın diye ad ayrıca yazılır.
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username    TEXT    NOT NULL DEFAULT '',
  action      TEXT    NOT NULL,
  target_type TEXT    NOT NULL DEFAULT '',
  target_id   TEXT    NOT NULL DEFAULT '',
  detail      TEXT    NOT NULL DEFAULT '',
  ip          TEXT    NOT NULL DEFAULT '',
  result      TEXT    NOT NULL DEFAULT 'ok'
);

CREATE INDEX idx_audit_ts ON audit_log(ts);
CREATE INDEX idx_audit_user ON audit_log(user_id, ts);

-- İzin listesi. Yeni yetenekler geldikçe migration ile eklenir.
INSERT INTO permissions (key, description) VALUES
  ('panel.view',      'Paneli görüntüleme'),
  ('metrics.view',    'İzleme ekranı ve metrikler'),
  ('docker.view',     'Container ve Docker kaynaklarını görüntüleme'),
  ('docker.action',   'Container başlat/durdur/yeniden başlat, prune, güncelleme'),
  ('docker.exec',     'Web terminal ile container içinde komut çalıştırma'),
  ('host.power',      'Sunucuyu yeniden başlatma/kapatma'),
  ('host.service',    'systemd servislerini yönetme'),
  ('settings.view',   'Ayarları görüntüleme'),
  ('settings.edit',   'Ayarları değiştirme'),
  ('users.manage',    'Kullanıcı ve rol yönetimi'),
  ('audit.view',      'Audit kayıtlarını görüntüleme');

INSERT INTO roles (id, name, description, is_system) VALUES
  (1, 'admin',     'Tam yetki', 1),
  (2, 'kullanici', 'Görüntüleme + container aksiyonları', 1),
  (3, 'izleyici',  'Yalnızca görüntüleme', 1);

-- admin: her şey
INSERT INTO role_permissions (role_id, permission_key)
SELECT 1, key FROM permissions;

-- kullanici: görüntüleme + docker aksiyonları (terminal ve host yetkisi yok)
INSERT INTO role_permissions (role_id, permission_key) VALUES
  (2, 'panel.view'), (2, 'metrics.view'), (2, 'docker.view'),
  (2, 'docker.action'), (2, 'settings.view');

-- izleyici: yalnızca görüntüleme
INSERT INTO role_permissions (role_id, permission_key) VALUES
  (3, 'panel.view'), (3, 'metrics.view'), (3, 'docker.view');
`,
};
