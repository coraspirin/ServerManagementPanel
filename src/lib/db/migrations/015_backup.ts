import type { Migration } from "./types";

/**
 * M3.4 — yedekleme motoru (restic).
 *
 * Depo parolası T3 ile şifreli saklanıyor. BUNUN BİR BEDELİ VAR ve arayüzde
 * açıkça yazıyor: MASTER_KEY kaybolursa panel parolayı çözemez ve yedekler
 * panel üzerinden okunamaz hâle gelir. Bu yüzden parola oluşturulurken
 * kullanıcıya BİR KEZ gösterilip "panel dışında da sakla" deniyor —
 * restic deposu panelsiz de açılabilir, yeter ki parola elde olsun.
 */
export const migration015: Migration = {
  version: 15,
  name: "backup",
  up: `
CREATE TABLE backup_repos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL UNIQUE,
  -- local | rclone | s3
  kind         TEXT    NOT NULL DEFAULT 'local',
  -- local: host üzerindeki yol. Diğerleri: restic deposu adresi.
  location     TEXT    NOT NULL,
  -- T3 ile şifreli JSON: { ciphertext, iv, authTag }
  password_enc TEXT    NOT NULL DEFAULT '',
  -- Off-site hedefler için ek ortam değişkenleri (anahtar=değer), şifreli.
  env_enc      TEXT    NOT NULL DEFAULT '',
  initialized  INTEGER NOT NULL DEFAULT 0,
  last_check_at INTEGER,
  last_error   TEXT    NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE backup_jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL UNIQUE,
  repo_id       INTEGER NOT NULL REFERENCES backup_repos(id) ON DELETE CASCADE,
  -- volume | host_dir | panel_db
  source_kind   TEXT    NOT NULL,
  -- volume adı ya da host yolu; panel_db için boş
  source        TEXT    NOT NULL DEFAULT '',
  -- Boşsa zamanlanmamış (yalnızca elle çalışır)
  schedule_cron TEXT    NOT NULL DEFAULT '',
  -- Yedek alınırken durdurulacak container (SQLite kullananlar için).
  -- Boşsa canlı kopyalanır.
  quiesce       TEXT    NOT NULL DEFAULT '',
  -- Satır başına bir restic --exclude deseni
  excludes      TEXT    NOT NULL DEFAULT '',
  keep_daily    INTEGER NOT NULL DEFAULT 7,
  keep_weekly   INTEGER NOT NULL DEFAULT 4,
  keep_monthly  INTEGER NOT NULL DEFAULT 6,
  enabled       INTEGER NOT NULL DEFAULT 1,
  last_run_at   INTEGER,
  last_status   TEXT    NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_backup_jobs_repo ON backup_jobs(repo_id);

CREATE TABLE backup_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      INTEGER NOT NULL REFERENCES backup_jobs(id) ON DELETE CASCADE,
  started_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at INTEGER,
  -- running | ok | error
  status      TEXT    NOT NULL DEFAULT 'running',
  snapshot_id TEXT    NOT NULL DEFAULT '',
  files_new   INTEGER NOT NULL DEFAULT 0,
  files_changed INTEGER NOT NULL DEFAULT 0,
  bytes_added INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  -- forget --prune sonucu
  pruned      INTEGER NOT NULL DEFAULT 0,
  detail      TEXT    NOT NULL DEFAULT '',
  actor       TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX idx_backup_runs_job ON backup_runs(job_id, started_at DESC);
CREATE INDEX idx_backup_runs_started ON backup_runs(started_at DESC);
`,
};
