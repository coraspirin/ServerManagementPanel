import type { Migration } from "./types";

/**
 * Çoklu sunucu: yığın adı sunucu başına tekil.
 *
 * 018 `name` sütununu tüm tabloda UNIQUE tanımlamıştı; iki sunucuya aynı
 * adla (ör. `uptime-kuma`) kurulum ikincisinde UNIQUE hatasıyla düşerdi.
 * Kısıt sütun tanımında olduğu için tablo yeniden kuruluyor. Başka tablo
 * `app_stacks`'e bağlı değil; kimlikler korunuyor.
 */
export const migration029: Migration = {
  version: 29,
  name: "stacks_per_host",
  up: `
CREATE TABLE app_stacks_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id      INTEGER NOT NULL DEFAULT 1,
  name         TEXT    NOT NULL,
  template_id  TEXT    NOT NULL,
  directory    TEXT    NOT NULL,
  variables    TEXT    NOT NULL DEFAULT '{}',
  installed_by TEXT    NOT NULL DEFAULT '',
  installed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_action  TEXT    NOT NULL DEFAULT '',
  last_error   TEXT    NOT NULL DEFAULT '',
  UNIQUE (host_id, name)
);

INSERT INTO app_stacks_new
  (id, host_id, name, template_id, directory, variables, installed_by, installed_at, last_action, last_error)
SELECT id, host_id, name, template_id, directory, variables, installed_by, installed_at, last_action, last_error
FROM app_stacks;

DROP TABLE app_stacks;
ALTER TABLE app_stacks_new RENAME TO app_stacks;
CREATE INDEX idx_app_stacks_host ON app_stacks(host_id);
`,
};
