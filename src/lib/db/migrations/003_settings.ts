import type { Migration } from "./types";

/**
 * M0.5 — T9 ayar deposu.
 *
 * Tablo YALNIZCA varsayılandan sapan değerleri tutar. Bir ayar burada yoksa
 * şemadaki varsayılan geçerlidir; "varsayılana dön" işlemi satırı siler.
 *
 * Host kapsamı için ayrı `host_id` kolonu YOK — scope_type='host' + scope_id
 * ile ifade edilir. İki mekanizma aynı şeyi anlatmamalı (T7 ile çakışmaz).
 */
export const migration003: Migration = {
  version: 3,
  name: "settings",
  up: `
CREATE TABLE settings (
  key             TEXT    NOT NULL,
  scope_type      TEXT    NOT NULL DEFAULT 'global',
  scope_id        TEXT    NOT NULL DEFAULT '',
  value           TEXT,
  -- Secret ayarlar için AES-256-GCM alanları (T3). Düz 'value' boş kalır.
  value_encrypted TEXT,
  iv              TEXT,
  auth_tag        TEXT,
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_by      TEXT    NOT NULL DEFAULT '',
  PRIMARY KEY (key, scope_type, scope_id)
) WITHOUT ROWID;

CREATE INDEX idx_settings_scope ON settings(scope_type, scope_id);

-- Env tohumlamasının bir kez çalıştığını işaretler (T9): sonraki açılışlarda
-- env yok sayılır, panelden yapılan değişiklik otoriterdir.
CREATE TABLE settings_seed_log (
  key       TEXT PRIMARY KEY,
  env_var   TEXT NOT NULL,
  seeded_at INTEGER NOT NULL DEFAULT (unixepoch())
) WITHOUT ROWID;
`,
};
