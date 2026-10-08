import type { Migration } from "./types";

/**
 * Yedekleme v2 — Docker / İşletim Sistemi / Veritabanı.
 *
 * Üç "sistem" işi (`category`), sunucu başına birer tane ve kaynakları
 * `backup_sources` satırlarında. Kullanıcının elle tanımladığı eski işler
 * `custom` olarak kalıyor; tek kaynakları `legacy` işaretiyle taşınıyor ki
 * restic aynı yolu (`/data`) görüp önceki snapshot'ı parent olarak bulsun —
 * aksi hâlde ilk yeni koşu tüm veriyi baştan tarardı.
 *
 * `backup_jobs.name` 015'ten beri tablo genelinde UNIQUE; SQLite kısıtı
 * tablo yeniden kurulmadan kaldıramıyor. Sistem işleri bu yüzden
 * `sys:<kategori>:<sunucu>` adıyla tutuluyor, arayüz adı kategoriden üretiyor.
 */
export const migration033: Migration = {
  version: 33,
  name: "backup_v2",
  up: `
ALTER TABLE backup_repos ADD COLUMN options_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE backup_repos ADD COLUMN stats_json TEXT NOT NULL DEFAULT '';
ALTER TABLE backup_repos ADD COLUMN stats_at INTEGER;
ALTER TABLE backup_repos ADD COLUMN verify_cron TEXT NOT NULL DEFAULT '30 4 1 * *';
ALTER TABLE backup_repos ADD COLUMN last_verify_at INTEGER;
ALTER TABLE backup_repos ADD COLUMN last_verify_status TEXT NOT NULL DEFAULT '';
ALTER TABLE backup_repos ADD COLUMN last_verify_detail TEXT NOT NULL DEFAULT '';

-- docker | os | database | custom
ALTER TABLE backup_jobs ADD COLUMN category TEXT NOT NULL DEFAULT 'custom';
-- 0 = kapalı; > 0 ise "en fazla N yedek" (restic --keep-last)
ALTER TABLE backup_jobs ADD COLUMN keep_last INTEGER NOT NULL DEFAULT 0;
ALTER TABLE backup_jobs ADD COLUMN notify_success INTEGER NOT NULL DEFAULT 0;
-- { autoInclude, retry, spaceCheck, lowPriority, anomaly, excludes[] }
ALTER TABLE backup_jobs ADD COLUMN options_json TEXT NOT NULL DEFAULT '{}';
-- Başarısız koşudan sonra yeniden deneme zamanı ve deneme sayısı.
ALTER TABLE backup_jobs ADD COLUMN retry_at INTEGER;
ALTER TABLE backup_jobs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX idx_backup_jobs_system
  ON backup_jobs(host_id, category) WHERE category <> 'custom';

CREATE TABLE backup_sources (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id       INTEGER NOT NULL REFERENCES backup_jobs(id) ON DELETE CASCADE,
  -- volume | host_dir | panel_db | container | db
  kind         TEXT    NOT NULL,
  -- volume adı, host yolu, container adı; panel_db için boş
  ref          TEXT    NOT NULL DEFAULT '',
  enabled      INTEGER NOT NULL DEFAULT 1,
  -- { stop?: boolean, legacy?: boolean }
  options_json TEXT    NOT NULL DEFAULT '{}',
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (job_id, kind, ref)
);

CREATE INDEX idx_backup_sources_job ON backup_sources(job_id);

INSERT INTO backup_sources (job_id, kind, ref, options_json)
  SELECT id, source_kind, source, '{"legacy":true}' FROM backup_jobs;

-- backup | restore | verify
ALTER TABLE backup_runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'backup';
ALTER TABLE backup_runs ADD COLUMN bytes_processed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE backup_runs ADD COLUMN files_total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE backup_runs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1;
-- Anormal boyut uyarısı metni; boşsa normal.
ALTER TABLE backup_runs ADD COLUMN anomaly TEXT NOT NULL DEFAULT '';
-- Son ~8 KB çıktı (hata ayıklama için).
ALTER TABLE backup_runs ADD COLUMN log TEXT NOT NULL DEFAULT '';

CREATE INDEX idx_backup_runs_kind ON backup_runs(host_id, kind, started_at DESC);
`,
};
