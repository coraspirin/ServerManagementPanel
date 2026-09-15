import type { Migration } from "./types";

/**
 * M2.8 — reverse proxy, sertifika takibi ve DDNS.
 */
export const migration011: Migration = {
  version: 11,
  name: "proxy",
  up: `
/*
  Yayınlanan alan adları.

  Hedef iki biçimde verilebiliyor:
    - container adı + port  → panel Docker ağı üzerinden erişir
    - serbest adres         → ağdaki başka bir makine (NAS, router, yazıcı)

  Caddy yapılandırması bu tablodan ÜRETİLİYOR, elle yazılan dosya panelin
  bildiğiyle çelişmesin diye. Üretilen dosya ayrı bir volume'da durur ve
  Caddyfile onu import eder; panelin kendi girişini tanımlayan ana Caddyfile'a
  panel hiç dokunmaz — kendi ayağını kesme riski olmasın.
*/
CREATE TABLE proxy_hosts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  domain      TEXT    NOT NULL UNIQUE,
  target_kind TEXT    NOT NULL DEFAULT 'container',  -- container | url
  target      TEXT    NOT NULL,                      -- container adı ya da host
  port        INTEGER NOT NULL DEFAULT 80,
  /*
    auto     → Let's Encrypt (alan adı gerçekten bu sunucuya çözülmeli)
    internal → Caddy'nin yerel CA'sı (LAN'da yeterli, tarayıcı uyarır)
    off      → düz HTTP
  */
  tls         TEXT    NOT NULL DEFAULT 'auto',
  websocket   INTEGER NOT NULL DEFAULT 1,
  enabled     INTEGER NOT NULL DEFAULT 1,
  -- Kart üzerinden yayınlandıysa hangi kart (M2.8 "bu servisi yayınla").
  app_id      INTEGER REFERENCES apps(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

/*
  Sertifika durumu.

  Caddy'nin kendi depolama biçimini okumak yerine, yayınlanan adrese TLS ile
  bağlanıp sunulan sertifikanın bitiş tarihi okunuyor. Sebep: bu yöntem
  sertifikayı KİMİN ürettiğinden bağımsız çalışır (Caddy, elle konmuş bir
  sertifika, önündeki başka bir proxy) ve "tarayıcının göreceği şey" ile
  birebir aynı şeyi ölçer.
*/
CREATE TABLE certificates (
  proxy_host_id INTEGER PRIMARY KEY REFERENCES proxy_hosts(id) ON DELETE CASCADE,
  issuer        TEXT    NOT NULL DEFAULT '',
  subject       TEXT    NOT NULL DEFAULT '',
  not_after     INTEGER,
  checked_at    INTEGER NOT NULL,
  error         TEXT    NOT NULL DEFAULT ''
) WITHOUT ROWID;

/*
  DDNS kayıtları.

  API anahtarı/token T3 ile şifreli (settings'teki secret'larla aynı biçim:
  ciphertext/iv/authTag JSON'u).
*/
CREATE TABLE ddns_records (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  provider    TEXT    NOT NULL,              -- cloudflare | duckdns
  hostname    TEXT    NOT NULL,
  -- Cloudflare için zone id; DuckDNS'te kullanılmaz.
  zone        TEXT    NOT NULL DEFAULT '',
  secret      TEXT    NOT NULL DEFAULT '',   -- şifreli JSON
  enabled     INTEGER NOT NULL DEFAULT 1,
  last_ip     TEXT    NOT NULL DEFAULT '',
  last_sync_at INTEGER,
  last_error  TEXT    NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(provider, hostname)
);

INSERT INTO permissions (key, description) VALUES
  ('proxy.manage', 'Alan adı yayınlama, sertifika ve DDNS yönetimi');

INSERT INTO role_permissions (role_id, permission_key) VALUES
  (1, 'proxy.manage');
`,
};
