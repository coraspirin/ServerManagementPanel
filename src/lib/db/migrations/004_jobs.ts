import type { Migration } from "./types";

/**
 * M0.6 — T2 arka plan job altyapısı.
 *
 * `job_locks` kirası (lease) tek-instance garantisi verir: bugün zamanlayıcı
 * tek process içinde çalışsa da, ileride ayrı worker eklendiğinde ya da
 * dağıtım sırasında iki container bir an örtüştüğünde aynı iş iki kez
 * çalışmaz.
 */
export const migration004: Migration = {
  version: 4,
  name: "jobs",
  up: `
CREATE TABLE jobs (
  key            TEXT    PRIMARY KEY,
  enabled        INTEGER NOT NULL DEFAULT 1,
  last_run_at    INTEGER,
  last_finish_at INTEGER,
  last_duration_ms INTEGER,
  last_status    TEXT    NOT NULL DEFAULT 'bekliyor',
  last_error     TEXT,
  next_run_at    INTEGER,
  run_count      INTEGER NOT NULL DEFAULT 0,
  fail_count     INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

CREATE TABLE job_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_key     TEXT    NOT NULL REFERENCES jobs(key) ON DELETE CASCADE,
  started_at  INTEGER NOT NULL,
  duration_ms INTEGER,
  status      TEXT    NOT NULL,
  detail      TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX idx_job_runs_key_time ON job_runs(job_key, started_at DESC);

-- Kira tabanlı kilit: sahibi çökerse kira süresi dolunca iş serbest kalır.
CREATE TABLE job_locks (
  job_key    TEXT    PRIMARY KEY,
  owner      TEXT    NOT NULL,
  acquired_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;
`,
};
