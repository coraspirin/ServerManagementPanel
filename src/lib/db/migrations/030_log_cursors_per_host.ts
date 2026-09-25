import type { Migration } from "./types";

/**
 * Çoklu sunucu: log imleçleri sunucu başına.
 *
 * `log_cursors` birincil anahtarı yalnızca kaynak adıydı (`pihole`,
 * `ssh.service`); iki sunucudaki aynı adlı kaynak tek imleci paylaşır ve biri
 * diğerinin satırlarını atlatırdı. Anahtar (host_id, source) oluyor. Mevcut
 * imleçler yerel sunucuya ait.
 */
export const migration030: Migration = {
  version: 30,
  name: "log_cursors_per_host",
  up: `
CREATE TABLE log_cursors_new (
  host_id     INTEGER NOT NULL DEFAULT 1,
  source      TEXT    NOT NULL,
  kind        TEXT    NOT NULL DEFAULT 'container',
  last_ts     INTEGER NOT NULL DEFAULT 0,
  last_run_at INTEGER,
  last_count  INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT    NOT NULL DEFAULT '',
  PRIMARY KEY (host_id, source)
) WITHOUT ROWID;

INSERT INTO log_cursors_new (host_id, source, kind, last_ts, last_run_at, last_count, last_error)
SELECT 1, source, kind, last_ts, last_run_at, last_count, last_error FROM log_cursors;

DROP TABLE log_cursors;
ALTER TABLE log_cursors_new RENAME TO log_cursors;

CREATE INDEX IF NOT EXISTS idx_log_lines_host_ts ON log_lines(host_id, ts);
`,
};
