import type { Migration } from "./types";

/**
 * Çoklu sunucu (T7'nin devamı).
 *
 * 001 `hosts` tablosunu ve zaman serisi tablolarındaki `host_id`'yi zaten
 * açmıştı; burada uzak sunucuya (panel-agent) bağlanmak için gerekenler ve
 * sunucu bazlı hâle gelen diğer tablolardaki `host_id` ekleniyor.
 *
 * `host_id` NEDEN FOREIGN KEY DEĞİL: SQLite, `foreign_keys = ON` iken
 * `ALTER TABLE ... ADD COLUMN ... REFERENCES` ile NULL olmayan varsayılan
 * değeri reddeder. Tabloyu baştan kurmak (rename/copy) her tablo için ayrı
 * risk demek; sunucu silinirken ilgili satırlar `removeHost()` içinde tek
 * işlemde açıkça siliniyor.
 *
 * Birincil anahtarı metin olan tablolar (port_expectations, port_forwards,
 * log_cursors) bu migration'da DEĞİL: anahtarlarına sunucu eklemek tabloyu
 * yeniden kurmayı gerektiriyor ve o iş ilgili özelliğin fazında yapılıyor.
 */
export const migration026: Migration = {
  version: 26,
  name: "multi_host",
  up: `
ALTER TABLE hosts ADD COLUMN agent_url        TEXT;
-- Ajanın paylaşılan sırrı, MASTER_KEY ile şifreli (EncryptedValue JSON'u).
ALTER TABLE hosts ADD COLUMN token_enc        TEXT;
-- Ajanın TLS sertifikasının sha256 parmak izi; kayıt anında sabitlenir.
ALTER TABLE hosts ADD COLUMN cert_fingerprint TEXT;
-- unknown | pending | online | offline | incompatible
ALTER TABLE hosts ADD COLUMN status           TEXT    NOT NULL DEFAULT 'unknown';
ALTER TABLE hosts ADD COLUMN last_seen        INTEGER;
ALTER TABLE hosts ADD COLUMN latency_ms       INTEGER;
ALTER TABLE hosts ADD COLUMN last_error       TEXT;
ALTER TABLE hosts ADD COLUMN agent_version    TEXT;
ALTER TABLE hosts ADD COLUMN protocol         INTEGER;
-- JSON: {"docker":true,"helper":true,...}
ALTER TABLE hosts ADD COLUMN capabilities     TEXT    NOT NULL DEFAULT '{}';
ALTER TABLE hosts ADD COLUMN hostname         TEXT;
ALTER TABLE hosts ADD COLUMN os_name          TEXT;
ALTER TABLE hosts ADD COLUMN enabled          INTEGER NOT NULL DEFAULT 1;
ALTER TABLE hosts ADD COLUMN sort_order       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hosts ADD COLUMN color            TEXT;

UPDATE hosts SET status = 'online' WHERE is_local = 1;

ALTER TABLE app_stacks     ADD COLUMN host_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE backup_repos   ADD COLUMN host_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE backup_jobs    ADD COLUMN host_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE backup_runs    ADD COLUMN host_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE db_connections ADD COLUMN host_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE job_runs       ADD COLUMN host_id INTEGER;
-- NULL = elle eklenmiş / tüm sunuculara ait başlatıcı kaydı.
ALTER TABLE apps           ADD COLUMN host_id INTEGER;

CREATE INDEX idx_app_stacks_host     ON app_stacks(host_id);
CREATE INDEX idx_backup_repos_host   ON backup_repos(host_id);
CREATE INDEX idx_backup_jobs_host    ON backup_jobs(host_id);
CREATE INDEX idx_backup_runs_host    ON backup_runs(host_id);
CREATE INDEX idx_db_connections_host ON db_connections(host_id);
CREATE INDEX idx_apps_host           ON apps(host_id);

INSERT OR IGNORE INTO permissions (key, description) VALUES
  ('hosts.view',   'Sunucu listesini ve durumlarını görme'),
  ('hosts.manage', 'Sunucu ekleme, kaydetme, anahtar yenileme ve silme');

INSERT OR IGNORE INTO role_permissions (role_id, permission_key) VALUES
  (1, 'hosts.view'),
  (1, 'hosts.manage');

-- Sunucu listesini görmek, zaten paneli görebilen herkese açık: seçici
-- yalnızca ad ve durum gösterir.
INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT role_id, 'hosts.view' FROM role_permissions WHERE permission_key = 'panel.view';
`,
};
