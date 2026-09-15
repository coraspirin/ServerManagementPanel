import type { Migration } from "./types";

/**
 * M3.3 — merkezi log arama.
 *
 * FTS5 "external content" biçiminde kuruluyor: satırların kendisi normal bir
 * tabloda (log_lines), tam metin indeksi ise yalnızca mesaj sütununu tutan bir
 * sanal tabloda. Sebep pratik:
 *
 *   - Zaman ve kaynak filtreleri gerçek B-tree indeks ister; FTS5 tablosunda
 *     UNINDEXED sütun üzerinden filtrelemek her sorguda tam tarama demektir.
 *   - Budama (retention) ts aralığıyla siliyor. Normal tabloda indeksli,
 *     sanal tabloda taramalı olurdu.
 *   - Aynı metni iki kez saklamamak için content='log_lines' kullanılıyor;
 *     indeks yalnızca sözcük listesini tutar.
 *
 * Tokenizer'da `remove_diacritics 2`: "olcum" yazıp "ölçüm" bulunuyor. Türkçe
 * log aramasında bu, aksanlı harfleri doğru yazma zorunluluğunu kaldırıyor.
 */
export const migration014: Migration = {
  version: 14,
  name: "logs",
  up: `
CREATE TABLE log_lines (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id INTEGER NOT NULL DEFAULT 1 REFERENCES hosts(id) ON DELETE CASCADE,
  ts      INTEGER NOT NULL,
  -- container adı ya da journald birimi
  source  TEXT    NOT NULL,
  -- container | journald
  kind    TEXT    NOT NULL DEFAULT 'container',
  -- stdout | stderr | (journald önceliği)
  stream  TEXT    NOT NULL DEFAULT '',
  -- debug | info | warning | error — mesajdan tahmin edilir
  level   TEXT    NOT NULL DEFAULT 'info',
  message TEXT    NOT NULL
);

CREATE INDEX idx_log_lines_ts ON log_lines(ts DESC);
CREATE INDEX idx_log_lines_source ON log_lines(source, ts DESC);
CREATE INDEX idx_log_lines_level ON log_lines(level, ts DESC);

CREATE VIRTUAL TABLE log_fts USING fts5(
  message,
  content = 'log_lines',
  content_rowid = 'id',
  tokenize = 'unicode61 remove_diacritics 2'
);

-- External content tablosunda indeks OTOMATİK güncellenmez; tetikleyiciler
-- zorunludur. Biri unutulursa arama sessizce eskimiş sonuç döndürür.
CREATE TRIGGER log_lines_ai AFTER INSERT ON log_lines BEGIN
  INSERT INTO log_fts(rowid, message) VALUES (new.id, new.message);
END;

CREATE TRIGGER log_lines_ad AFTER DELETE ON log_lines BEGIN
  INSERT INTO log_fts(log_fts, rowid, message) VALUES ('delete', old.id, old.message);
END;

CREATE TRIGGER log_lines_au AFTER UPDATE ON log_lines BEGIN
  INSERT INTO log_fts(log_fts, rowid, message) VALUES ('delete', old.id, old.message);
  INSERT INTO log_fts(rowid, message) VALUES (new.id, new.message);
END;

-- Toplayıcının nereye kadar okuduğu. Kaynak bazında: bir container yeniden
-- oluşturulduğunda diğerlerinin imleci geri gitmemeli.
CREATE TABLE log_cursors (
  source      TEXT    PRIMARY KEY,
  kind        TEXT    NOT NULL DEFAULT 'container',
  last_ts     INTEGER NOT NULL DEFAULT 0,
  last_run_at INTEGER,
  last_count  INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT    NOT NULL DEFAULT ''
) WITHOUT ROWID;

-- Desen kuralları: eşleşen satır olay üretir ve bildirime gider.
CREATE TABLE log_patterns (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT    NOT NULL,
  pattern          TEXT    NOT NULL,
  -- 0 = düz metin (harf büyüklüğü önemsiz), 1 = düzenli ifade
  is_regex         INTEGER NOT NULL DEFAULT 0,
  -- Boşsa tüm kaynaklar; doluysa yalnızca bu kaynak adı
  source_filter    TEXT    NOT NULL DEFAULT '',
  severity         TEXT    NOT NULL DEFAULT 'warning',
  enabled          INTEGER NOT NULL DEFAULT 1,
  -- Aynı desen için iki alarm arası en az bu kadar dakika geçmeli. Bir OOM
  -- döngüsü dakikada yüz satır yazabilir; hepsini bildirmek telefonu susturur.
  cooldown_minutes INTEGER NOT NULL DEFAULT 30,
  last_hit_at      INTEGER,
  hit_count        INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Hazır kurallar. Hepsi kapalı başlamıyor: bunlar gerçekten önemli olan ve
-- yanlış pozitif üretmesi zor desenler.
INSERT INTO log_patterns (name, pattern, is_regex, severity, cooldown_minutes) VALUES
  ('Bellek yetersizliği (OOM)', 'Out of memory|oom-kill|Killed process', 1, 'critical', 30),
  ('Kimlik doğrulama hatası', 'authentication fail|Failed password|invalid user', 1, 'warning', 60),
  ('Disk yazma hatası', 'I/O error|No space left on device|read-only file system', 1, 'critical', 30),
  ('Servis çöktü', 'panic:|segfault|FATAL|Fatal error', 1, 'critical', 30);
`,
};
