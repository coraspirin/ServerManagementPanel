import type { Migration } from "./types";

/**
 * M0.3 — temel şema: host kaydı (T7) ve metrik katmanları (T1).
 *
 * Metrikler dar (narrow/EAV) tabloda tutuluyor: `metric` + `label`.
 * Sebebi: disk ve ağ arayüzü sayısı değişkendir (disk takılır, arayüz gelir
 * gider). Geniş tabloda her yeni disk için şema değişikliği gerekirdi.
 * Dar tabloda rollup da tek ve genel bir sorguyla yapılabiliyor.
 */
export const migration001: Migration = {
  version: 1,
  name: "foundation",
  up: `
-- T7: bugün tek sunucu, ama tüm kaynak/zaman serisi tabloları host_id taşır.
CREATE TABLE hosts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  address     TEXT,
  agent_type  TEXT    NOT NULL DEFAULT 'local',
  is_local    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO hosts (id, name, agent_type, is_local)
VALUES (1, 'local', 'local', 1);

-- T1: ham örnekler. Çözünürlük monitoring.collect_interval ayarına eşittir.
-- Saklama süreleri koda yazılmaz; budama job'ı ayarlardan okur (M0.5/M0.6).
CREATE TABLE metrics_raw (
  host_id INTEGER NOT NULL DEFAULT 1 REFERENCES hosts(id) ON DELETE CASCADE,
  metric  TEXT    NOT NULL,           -- ör. 'cpu.pct', 'mem.used', 'disk.used'
  label   TEXT    NOT NULL DEFAULT '', -- mount noktası / arayüz adı / boş
  ts      INTEGER NOT NULL,            -- unix epoch, saniye
  value   REAL    NOT NULL,
  PRIMARY KEY (host_id, metric, label, ts)
) WITHOUT ROWID;

-- Budama (DELETE ... WHERE ts < ?) birincil anahtarı kullanamaz.
CREATE INDEX idx_metrics_raw_ts ON metrics_raw(ts);

-- Rollup katmanları. Grafik API'si istenen aralığa göre doğru tabloyu seçer.
CREATE TABLE metrics_1m (
  host_id      INTEGER NOT NULL DEFAULT 1 REFERENCES hosts(id) ON DELETE CASCADE,
  metric       TEXT    NOT NULL,
  label        TEXT    NOT NULL DEFAULT '',
  ts           INTEGER NOT NULL,       -- kova başlangıcı
  avg_value    REAL    NOT NULL,
  min_value    REAL    NOT NULL,
  max_value    REAL    NOT NULL,
  sample_count INTEGER NOT NULL,
  PRIMARY KEY (host_id, metric, label, ts)
) WITHOUT ROWID;

CREATE INDEX idx_metrics_1m_ts ON metrics_1m(ts);

CREATE TABLE metrics_1h (
  host_id      INTEGER NOT NULL DEFAULT 1 REFERENCES hosts(id) ON DELETE CASCADE,
  metric       TEXT    NOT NULL,
  label        TEXT    NOT NULL DEFAULT '',
  ts           INTEGER NOT NULL,
  avg_value    REAL    NOT NULL,
  min_value    REAL    NOT NULL,
  max_value    REAL    NOT NULL,
  sample_count INTEGER NOT NULL,
  PRIMARY KEY (host_id, metric, label, ts)
) WITHOUT ROWID;

CREATE INDEX idx_metrics_1h_ts ON metrics_1h(ts);

CREATE TABLE metrics_1d (
  host_id      INTEGER NOT NULL DEFAULT 1 REFERENCES hosts(id) ON DELETE CASCADE,
  metric       TEXT    NOT NULL,
  label        TEXT    NOT NULL DEFAULT '',
  ts           INTEGER NOT NULL,
  avg_value    REAL    NOT NULL,
  min_value    REAL    NOT NULL,
  max_value    REAL    NOT NULL,
  sample_count INTEGER NOT NULL,
  PRIMARY KEY (host_id, metric, label, ts)
) WITHOUT ROWID;

CREATE INDEX idx_metrics_1d_ts ON metrics_1d(ts);
`,
};
