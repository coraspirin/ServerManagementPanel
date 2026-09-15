import type { Migration } from "./types";

/**
 * M3.11 — otomasyon kuralları, API anahtarları ve çalışma geçmişi.
 *
 * TASARIM AYRIMI (alarm motoru ↔ otomasyon): M1.3'teki alarm motoru "bir
 * durum sorun mu, ne kadar süredir sürüyor, tekrar bildirilmeli mi" sorusunu
 * yanıtlıyor ve çıktısı `events` satırıdır. Otomasyon o çıktının ÜSTÜNE
 * biniyor: "bu olay olduğunda ne YAPILSIN". İkisini tek motora sokmak,
 * bildirim mantığıyla eylem mantığını birbirine düğümlerdi.
 *
 * `webhook_slug` ve `webhook_secret_hash` ayrı bir tabloda değil burada:
 * gelen webhook bir TETİKLEYİCİ türüdür, bağımsız bir varlık değil. Ayrı
 * tabloya konsaydı "hiçbir kurala bağlı olmayan webhook" gibi anlamsız bir
 * durum mümkün olurdu.
 */
export const migration019: Migration = {
  version: 19,
  name: "automation",
  up: `
CREATE TABLE automations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL UNIQUE,
  description   TEXT    NOT NULL DEFAULT '',
  enabled       INTEGER NOT NULL DEFAULT 1,
  -- 'event' | 'webhook' | 'schedule'
  trigger_kind  TEXT    NOT NULL,
  trigger_config TEXT   NOT NULL DEFAULT '{}',
  conditions    TEXT    NOT NULL DEFAULT '[]',
  actions       TEXT    NOT NULL DEFAULT '[]',
  -- Bekleme süresi: flap eden bir container'ı saniyede bir yeniden başlatmak,
  -- çözmeye çalıştığı sorundan büyük bir sorun olurdu.
  cooldown_seconds INTEGER NOT NULL DEFAULT 300,
  -- Yalnızca trigger_kind='webhook' iken dolu. SQLite'ta UNIQUE birden çok
  -- NULL'a izin verir; diğer kurallar bu yüzden çakışmaz.
  webhook_slug  TEXT    UNIQUE,
  webhook_secret_hash TEXT,
  last_fired_at INTEGER,
  fire_count    INTEGER NOT NULL DEFAULT 0,
  created_by    TEXT    NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX automations_trigger ON automations(trigger_kind, enabled);

-- Çalışma geçmişi: eşleşmeyen turlar da yazılır. "Kuralım neden çalışmadı"
-- sorusunun cevabı, çalışmayan turların hiç kaydedilmediği bir tabloda yoktur.
CREATE TABLE automation_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  automation_id  INTEGER NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  ts             INTEGER NOT NULL DEFAULT (unixepoch()),
  trigger_summary TEXT   NOT NULL DEFAULT '',
  matched        INTEGER NOT NULL DEFAULT 0,
  skipped_reason TEXT    NOT NULL DEFAULT '',
  dry_run        INTEGER NOT NULL DEFAULT 0,
  ok             INTEGER NOT NULL DEFAULT 1,
  detail         TEXT    NOT NULL DEFAULT '',
  duration_ms    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX automation_runs_recent ON automation_runs(automation_id, ts DESC);

/*
 * API anahtarları — Prometheus scrape'i ve dış entegrasyon için.
 *
 * Oturum çerezi kullanılamaz: Grafana'nın ya da bir script'in çerezi yoktur.
 * Anahtarın kendisi SAKLANMIYOR, yalnızca sha256 özeti (oturum ve kiosk
 * token'larıyla aynı kural). Kullanıcıya bir kez gösterilir; kaybedilirse
 * yenisi üretilir, "hatırlatma" diye bir şey olamaz.
 *
 * prefix sütunu yalnızca listede tanımak için: hangi anahtarın iptal
 * edileceğini seçebilmek gerekir ve bunun için tam değeri bilmeye gerek yok.
 *
 * Kapsamlar RBAC izinleri DEĞİL ve permissions tablosuna yazılmıyor: bir
 * API anahtarı bir kullanıcıyı temsil etmiyor, dar ve sabit bir yüzeyi
 * temsil ediyor. Rol izinleriyle aynı listeye konsalardı bir gün birinin
 * rolüne "metrik okuma" diye anlamsız bir izin verilebilirdi.
 */
CREATE TABLE api_tokens (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  prefix       TEXT    NOT NULL,
  token_hash   TEXT    NOT NULL UNIQUE,
  -- Virgülle ayrık kapsam listesi: metrics.read, events.read, automation.trigger
  scopes       TEXT    NOT NULL DEFAULT '',
  created_by   TEXT    NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at   INTEGER,
  last_used_at INTEGER,
  last_used_from TEXT  NOT NULL DEFAULT '',
  revoked_at   INTEGER
);
`,
};
