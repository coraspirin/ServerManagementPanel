import type { Migration } from "./types";

/**
 * Dışa açık API — bearer token'ları (T12).
 *
 * TABLO GERİ GELİYOR, KURAL MOTORU GELMİYOR. 019 bir `api_tokens` tablosu
 * açmıştı, 022 onu otomasyon bölümüyle BİRLİKTE sildi ve gerekçesini yazdı:
 * anahtar üretecek arayüz kalmayınca anahtarların tek tüketicisi olan
 * /metrics ucu da kullanılamaz hâle gelmişti. Eksik olan token değil, token
 * üreten arayüzdü. Bu sefer arayüz de geliyor (/hesap → API anahtarları),
 * tetikleyici mantığı ise panelde değil çağıran tarafta (n8n, HA) kalıyor.
 *
 * KAPSAM RBAC'İN KENDİSİ, AYRI BİR SÖZLÜK DEĞİL. 019 kapsamları ayrı tutmuştu
 * ("bir API anahtarı bir kullanıcıyı temsil etmiyor"). O not tutarlıydı ama
 * bedeli iki paralel yetki sözlüğüydü. Burada token bir KULLANICIYA bağlı ve
 * `permissions` sütunu o kullanıcının izinlerinin bir ALT KÜMESİ. Token
 * sahibinden fazlasını asla alamaz, çünkü kesişim her istekte çözümleme
 * anında yeniden alınır (apitoken.ts) — rol daraltılınca token da daralır.
 *
 * `api.manage` NEDEN AYRI BİR İZİN: token; uzun ömürlü, tarayıcısız ve
 * 2FA'sız bir kimlik. `panel.view` ile herkese açık olsaydı, 2FA'sı açık bir
 * kullanıcı kendine token üreterek ikinci faktörü kalıcı olarak devre dışı
 * bırakabilirdi. Bu yüzden yöneticinin bilerek verdiği ayrı bir izin.
 * `host.power` ve `host.shell` gibi admin dışında kimseye otomatik verilmez.
 */
export const migration025: Migration = {
  version: 25,
  name: "api_tokens",
  up: `
CREATE TABLE api_tokens (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  -- Listede tanımak için: "pnl_" + 8 karakter. Tek başına kullanılamaz, bu
  -- yüzden log ve audit kaydında güvenle görünebilir. Daha uzun bir önek
  -- log'a düşen her satırı token'a bir adım yaklaştırırdı.
  prefix         TEXT    NOT NULL,
  -- Düz değer HİÇBİR yerde saklanmaz; yalnızca sha256 özeti. Oturum ve kiosk
  -- token'larıyla aynı kural: veritabanı sızarsa anahtarlar ele geçirilemez.
  token_hash     TEXT    NOT NULL UNIQUE,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Virgülle ayrık PermissionKey listesi. Sahibinin izinlerinin alt kümesi.
  permissions    TEXT    NOT NULL DEFAULT '',
  -- 'manual' = panelden elle üretildi | 'device' = mobil cihaz doğrulamasından
  -- otomatik üretildi. İkisi aynı tabloda: ikisi de "bir kullanıcı adına
  -- konuşan bearer kimliği" ve iptal, kesişim, TTL mantığı birebir aynı.
  kind           TEXT    NOT NULL DEFAULT 'manual',
  device_id      TEXT,
  -- Push kaydı AYRI TABLODA DEĞİL: bir push adresi, ait olduğu cihazdan
  -- bağımsız anlamsızdır. 019'un webhook_slug'ı automations tablosunda
  -- tuttuğu gerekçenin aynısı — sahipsiz satır mümkün olmamalı.
  push_token     TEXT,
  push_platform  TEXT    NOT NULL DEFAULT '',
  created_by     TEXT    NOT NULL DEFAULT '',
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at     INTEGER,
  last_used_at   INTEGER,
  last_used_from TEXT    NOT NULL DEFAULT '',
  -- İptal satırı SİLMEZ: "bu anahtar ne zaman ve neden kapandı" sorusunun
  -- cevabı kalmalı. Sınırsız büyümeyi api.tokens_prune işi engelliyor.
  revoked_at     INTEGER
);

CREATE INDEX api_tokens_user ON api_tokens(user_id);

-- kind='device' satırları için cihaz başına tek token. Kısmi indeks: SQLite'ta
-- WHERE'li UNIQUE, NULL device_id'li elle üretilmiş anahtarları kapsamaz.
CREATE UNIQUE INDEX api_tokens_device ON api_tokens(device_id) WHERE device_id IS NOT NULL;

INSERT OR IGNORE INTO permissions (key, description) VALUES
  ('api.manage', 'Dış API anahtarı üretme ve iptal etme');

INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
VALUES (1, 'api.manage');
`,
};
