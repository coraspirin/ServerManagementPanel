import type { Migration } from "./types";

/**
 * M3.6 — veritabanı yöneticisi.
 *
 * Bağlantı parolaları T3 ile şifreli. Bağlantı bazında `writable` bayrağı var
 * ve VARSAYILAN KAPALI: `db.write` iznine sahip biri bile, bağlantı açıkça
 * yazılabilir işaretlenmedikçe veri değiştiremez. İki ayrı kapı, çünkü
 * "üretim veritabanına yanlışlıkla UPDATE atmak" geri alınamaz.
 */
export const migration016: Migration = {
  version: 16,
  name: "dbadmin",
  up: `
CREATE TABLE db_connections (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL UNIQUE,
  -- sqlite | postgres | mysql | redis
  engine       TEXT    NOT NULL,
  -- sqlite: host üzerindeki dosya yolu. Diğerleri: sunucu adresi.
  host         TEXT    NOT NULL DEFAULT '',
  port         INTEGER NOT NULL DEFAULT 0,
  username     TEXT    NOT NULL DEFAULT '',
  password_enc TEXT    NOT NULL DEFAULT '',
  database     TEXT    NOT NULL DEFAULT '',
  -- Yazma bağlantı bazında açılır; izin tek başına yetmez.
  writable     INTEGER NOT NULL DEFAULT 0,
  -- Docker keşfinden mi geldi, elle mi eklendi (manual | docker)
  source       TEXT    NOT NULL DEFAULT 'manual',
  container    TEXT    NOT NULL DEFAULT '',
  last_ok_at   INTEGER,
  last_error   TEXT    NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE db_query_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id INTEGER NOT NULL REFERENCES db_connections(id) ON DELETE CASCADE,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username      TEXT    NOT NULL DEFAULT '',
  sql           TEXT    NOT NULL,
  ts            INTEGER NOT NULL DEFAULT (unixepoch()),
  duration_ms   INTEGER NOT NULL DEFAULT 0,
  row_count     INTEGER NOT NULL DEFAULT 0,
  ok            INTEGER NOT NULL DEFAULT 1,
  error         TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX idx_db_history_user ON db_query_history(user_id, ts DESC);
CREATE INDEX idx_db_history_conn ON db_query_history(connection_id, ts DESC);

CREATE TABLE db_saved_queries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id INTEGER REFERENCES db_connections(id) ON DELETE SET NULL,
  name          TEXT    NOT NULL,
  sql           TEXT    NOT NULL,
  username      TEXT    NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
`,
};
