import type { Migration } from "./types";

/**
 * M1.2 — health-check, uptime geçmişi ve bakım pencereleri.
 *
 * `uptime_log` DURUM DEĞİŞİMLERİNİ tutar, her kontrolü değil. Her kontrolü
 * yazmak 60 saniyelik aralıkta monitör başına yılda ~525 bin satır demekti;
 * oysa bir servis günlerce aynı durumda kalır. Değişim günlüğünden kullanılabilirlik
 * yüzdesi ve kesinti süresi birebir hesaplanabiliyor.
 *
 * Gecikme (latency) ise ayrı tutulmuyor: `monitor.latency` metriği olarak
 * `metrics_raw`'a yazılıyor ve T1'in rollup/budama/grafik makinesini olduğu gibi
 * kullanıyor. `label` = monitör kimliği.
 */
export const migration005: Migration = {
  version: 5,
  name: "monitors",
  up: `
CREATE TABLE monitors (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id           INTEGER NOT NULL DEFAULT 1 REFERENCES hosts(id) ON DELETE CASCADE,
  name              TEXT    NOT NULL,
  type              TEXT    NOT NULL,               -- http | tcp | ping | dns | container
  target            TEXT    NOT NULL,               -- URL / host:port / ad
  expected          TEXT    NOT NULL DEFAULT '',    -- tipe göre beklenen yanıt
  enabled           INTEGER NOT NULL DEFAULT 1,
  -- Ev sunucularında self-signed sertifika kuraldır; kullanılabilirlik ölçerken
  -- sertifika doğrulamasını atlamak MEŞRU ama sessizce yapılmamalı — monitör
  -- bazında ve açıkça işaretlenir.
  ignore_tls        INTEGER NOT NULL DEFAULT 0,

  -- NULL = ayarlardaki global değer kullanılır (T9 kaynak bazında ezme).
  interval_seconds  INTEGER,
  timeout_seconds   INTEGER,
  retries           INTEGER,
  down_threshold    INTEGER,

  -- Çalışma durumu (job runner günceller)
  status            TEXT    NOT NULL DEFAULT 'bilinmiyor', -- up | down | bilinmiyor
  consecutive_fails INTEGER NOT NULL DEFAULT 0,
  consecutive_ok    INTEGER NOT NULL DEFAULT 0,
  last_check_at     INTEGER,
  last_change_at    INTEGER,
  last_latency_ms   INTEGER,
  last_error        TEXT,
  next_check_at     INTEGER,

  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_monitors_due ON monitors(enabled, next_check_at);

-- Durum değişimi günlüğü. Bir monitörün ilk kaydı ilk kontrolde düşer.
CREATE TABLE uptime_log (
  monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  ts         INTEGER NOT NULL,
  status     TEXT    NOT NULL,      -- up | down | bakim
  latency_ms INTEGER,
  error      TEXT,
  PRIMARY KEY (monitor_id, ts)
) WITHOUT ROWID;

CREATE INDEX idx_uptime_ts ON uptime_log(ts);

/*
  Bakım penceresi: içindeyken monitör kontrol edilir ama DURUM DEĞİŞİMİ
  bildirilmez ve kullanılabilirlik hesabından düşülür. Böylece planlı bir
  yeniden başlatma "kesinti" olarak görünmez (M1.3 alarmları da susar).

  İki biçim: tek seferlik (starts_at/ends_at) ve haftalık tekrar
  (weekdays + gün içi dakika aralığı).
*/
CREATE TABLE maintenance_windows (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  kind         TEXT    NOT NULL DEFAULT 'once',  -- once | weekly
  starts_at    INTEGER,                          -- once
  ends_at      INTEGER,                          -- once
  weekdays     TEXT    NOT NULL DEFAULT '',      -- weekly: '0,6' (0 = Pazar)
  start_minute INTEGER,                          -- weekly: gün içi dakika 0-1439
  end_minute   INTEGER,
  monitor_id   INTEGER REFERENCES monitors(id) ON DELETE CASCADE, -- NULL = tümü
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Monitör yönetimi ayrı bir yetki: izleyici görebilsin ama değiştiremesin.
INSERT INTO permissions (key, description) VALUES
  ('monitors.manage', 'Servis izleme ve bakım penceresi tanımlama');

INSERT INTO role_permissions (role_id, permission_key) VALUES
  (1, 'monitors.manage');
`,
};
