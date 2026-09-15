import type { Migration } from "./types";

/**
 * M1.3 — olaylar ve alarm durumu.
 *
 * İki tablo iki farklı soruya cevap verir:
 *   - `events`: NE OLDU. Değişmez bir günlük; bastırılan bildirimler de buraya
 *     düşer ve neden bastırıldığı yazılır. "Neden haber gelmedi?" sorusunun
 *     cevabı burada olmalı, yoksa sessiz kalan bir alarm sistemi hata ayıklanamaz.
 *   - `alert_state`: ŞU AN NE DURUMDA. Tekrarlı bildirimi (dedup), flap
 *     korumasını ve tırmandırmayı (escalation) yürütmek için gereken sayaçlar.
 *
 * `alert_key` aynı sorunun tekrarını tanıyan kimliktir: `monitor:3`,
 * `metric:cpu`, `metric:disk:/mnt/veri`. Bir sorun çözülüp tekrar başlarsa
 * anahtar aynıdır, `alert_state` satırı güncellenir.
 */
export const migration006: Migration = {
  version: 6,
  name: "alerts",
  up: `
CREATE TABLE events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id           INTEGER NOT NULL DEFAULT 1 REFERENCES hosts(id) ON DELETE CASCADE,
  ts                INTEGER NOT NULL,
  alert_key         TEXT    NOT NULL,
  source            TEXT    NOT NULL,               -- monitor | metric | system
  severity          TEXT    NOT NULL,               -- ok | info | warning | critical
  title             TEXT    NOT NULL,
  detail            TEXT    NOT NULL DEFAULT '',
  -- Bildirim sonucu
  notified_channels TEXT    NOT NULL DEFAULT '',    -- 'telegram,ntfy'
  suppressed_reason TEXT,                           -- bakim | sessiz-saat | dedup | flap | kanal-yok | hata
  acknowledged_at   INTEGER,
  acknowledged_by   TEXT
);

CREATE INDEX idx_events_ts ON events(ts DESC);
CREATE INDEX idx_events_key ON events(alert_key, ts DESC);

CREATE TABLE alert_state (
  alert_key              TEXT    PRIMARY KEY,
  severity               TEXT    NOT NULL,          -- şu anki seviye
  since                  INTEGER NOT NULL,          -- bu seviyeye ne zaman girildi
  -- Flap koruması: seviyenin kaç ardışık turdur değişmediği. Eşiğe ulaşmadan
  -- bildirim gönderilmez, böylece sınırda gidip gelen bir değer telefonu
  -- çaldırıp durmaz.
  streak                 INTEGER NOT NULL DEFAULT 1,
  -- Dedup ve tırmandırma
  last_notified_at       INTEGER,
  last_notified_severity TEXT,
  escalated_at           INTEGER,
  -- Günlüğe en son hangi seviyenin yazıldığı. last_notified_severity'den AYRI
  -- tutuluyor: bastırılan bir alarm (bakım penceresi, sessiz saat) günlüğe bir
  -- kez düşmeli ama "bildirildi" sayılmamalı — pencere kapanınca bildirim yine
  -- gitmeli. Tek kolonla ya her turda olay tekrarlanır ya da alarm kaybolur.
  last_event_severity    TEXT,
  updated_at             INTEGER NOT NULL
) WITHOUT ROWID;
`,
};
