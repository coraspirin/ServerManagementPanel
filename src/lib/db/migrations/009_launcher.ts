import type { Migration } from "./types";

/**
 * M2.1 — App Launcher veri modeli.
 *
 * Faz 2'nin tamamı (kart CRUD M2.2, canlı durum M2.3, kategoriler M2.4,
 * otomatik keşif M2.5, widget'lar M2.6, ana sayfa M2.7, WoL M2.11, speedtest
 * M2.12) bu beş tablonun üstüne kuruluyor. Hepsi burada birlikte açılıyor
 * çünkü aralarındaki yabancı anahtarlar sonradan eklenemiyor: SQLite'ta
 * ALTER TABLE ile FK eklenemez, tabloyu yeniden yaratmak gerekir.
 *
 * `hosts` bağı bilerek YOK: bir kısayol kartı bu sunucuya değil, ağdaki
 * herhangi bir adrese işaret edebilir (router arayüzü, NAS, bulut servisi).
 * T7 çok-sunuculu geleceğinde bile launcher panelin kendisine aittir.
 */
export const migration009: Migration = {
  version: 9,
  name: "launcher",
  up: `
/*
  Kategoriler.

  Kartın kategorisi ZORUNLU DEĞİL (apps.category_id NULL olabilir): kullanıcı
  ilk kartını eklerken önce kategori kurmaya zorlanmamalı. Kategorisiz kartlar
  ekranda "Diğer" başlığı altında toplanır.
*/
CREATE TABLE app_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  -- lucide-react ikon adı (ör. 'Film'); boşsa varsayılan ikon kullanılır.
  icon       TEXT    NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE apps (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES app_categories(id) ON DELETE SET NULL,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',

  /*
    İki adres, iki farklı iş için:
      - url:          tıklanınca açılan adres (dışarıdan/normal erişim)
      - internal_url: panelin KENDİSİNİN kullandığı adres

    Ayrımın sebebi somut: kart "https://ha.evim.net" gösterebilir ama panel
    container'ının o adrese çıkışı reverse proxy ve DNS'e bağlıdır. Durum
    kontrolü (M2.3) ve widget'lar (M2.6) doğrudan "http://192.168.61.114:8123"
    üzerinden konuşmalı. Boşsa url kullanılır.
  */
  url          TEXT    NOT NULL,
  internal_url TEXT    NOT NULL DEFAULT '',

  /*
    Logo. Üç biçimden biri:
      - ''                     → favicon'a düş (M2.2)
      - 'upload:<dosya>'       → data/logos altındaki yüklenmiş dosya
      - 'http://' / 'https://' → uzak adres
    Yüklenen dosyanın kendisi veritabanında DEĞİL diskte tutulur: SQLite'a
    ikili veri koymak yedeği şişirir ve WAL'ı gereksiz yere büyütür.
  */
  icon      TEXT NOT NULL DEFAULT '',
  -- Kart rengi (#rrggbb). Boşsa ad'dan türetilir; iki kart aynı renkte olmasın.
  color     TEXT NOT NULL DEFAULT '',

  /*
    Canlı durum noktası (M2.3): kart bir monitör satırına BAĞLANIR, kendi
    kontrol mantığını taşımaz. M1.2'nin aralık/timeout/eşik/bakım penceresi
    makinesi olduğu gibi devralınıyor. Monitör silinirse kart kalır, sadece
    noktası söner.
  */
  monitor_id INTEGER REFERENCES monitors(id) ON DELETE SET NULL,

  /*
    Docker bağı (M2.5 otomatik keşif). Container ADI tutuluyor, id'si değil:
    id her "compose up" ile değişir, ad kalır (M1.8'deki runbook'larla aynı
    gerekçe).
  */
  container_name TEXT NOT NULL DEFAULT '',

  /*
    'manual' → kullanıcı ekledi, panel dokunmaz.
    'docker' → label'lardan keşfedildi; container silinince kart da gider.
    Ayrım şart: keşfedilen kartları elle düzenlenmişlerden ayırt edemezsek
    her keşif turu kullanıcının değişikliklerini ezerdi.
  */
  source TEXT NOT NULL DEFAULT 'manual',

  -- Widget (M2.6): sağlayıcı anahtarı + T3 ile şifreli yapılandırma (API
  -- anahtarları burada durur). Boşsa kart sade bir kısayoldur.
  widget_type   TEXT NOT NULL DEFAULT '',
  widget_config TEXT NOT NULL DEFAULT '',

  open_new_tab INTEGER NOT NULL DEFAULT 1,
  enabled      INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Keşif turu her container için "kart var mı" diye sorar; ad üzerinden tekillik
-- hem o sorguyu hızlandırır hem de aynı container'a iki kart açılmasını önler.
CREATE UNIQUE INDEX idx_apps_container ON apps(container_name)
  WHERE container_name <> '';

CREATE INDEX idx_apps_category ON apps(category_id, sort_order);

/*
  Bookmark'lar (M2.7 ana sayfa).

  Ayrı tablo, apps'ın bir bayrağı değil: bir bookmark'ın durumu izlenmez,
  logosu yüklenmez, widget'ı olmaz, container'ı yoktur. Aynı tabloya
  sıkıştırılsaydı satırların yarısı sürekli boş kalırdı.

  Grup adı serbest metin: bookmark grupları kategori tablosundan bağımsız
  ("Sık Kullanılan", "Dokümantasyon"), kart kategorileriyle karışmamalı.
*/
CREATE TABLE bookmarks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  group_name TEXT    NOT NULL DEFAULT '',
  title      TEXT    NOT NULL,
  url        TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

/*
  Wake-on-LAN hedefleri (M2.11; kayıtlar M2.9 ağ keşfinden de doldurulabilir).

  MAC normalize edilmiş biçimde (küçük harf, iki nokta ayraçlı) saklanır ve
  tekildir — aynı cihaz iki kez eklenmesin.
*/
CREATE TABLE wol_devices (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  mac        TEXT    NOT NULL UNIQUE,
  -- Sihirli paketin gideceği yayın adresi. Boşsa 255.255.255.255 kullanılır;
  -- yönlendirilmiş yayın gereken ağlarda (ör. 192.168.61.255) elle girilir.
  broadcast  TEXT    NOT NULL DEFAULT '',
  port       INTEGER NOT NULL DEFAULT 9,
  -- "Uyandı mı" kontrolü için (ping/TCP). Boşsa sonuç doğrulanmaz.
  check_host TEXT    NOT NULL DEFAULT '',
  last_sent_at INTEGER,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

/*
  Speedtest geçmişi (M2.12).

  Metrik hattına (T1) yazılmıyor: speedtest günde birkaç kez çalışan, tek
  seferde birden çok değer üreten ve BAŞARISIZ da olabilen bir ölçüm. Metrik
  tablosu tek sayı tutar ve rollup ortalaması alır — 12 saatte bir alınan üç
  örneğin saatlik ortalamasının bir anlamı yok. Ayrıca hangi sunucuya karşı
  ölçüldüğü sonucun yorumu için şart ve metrik satırının label alanına sığmaz.
*/
CREATE TABLE speedtest_results (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            INTEGER NOT NULL,
  ok            INTEGER NOT NULL DEFAULT 1,
  download_mbps REAL,
  upload_mbps   REAL,
  ping_ms       REAL,
  jitter_ms     REAL,
  server_name   TEXT NOT NULL DEFAULT '',
  isp           TEXT NOT NULL DEFAULT '',
  error         TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_speedtest_ts ON speedtest_results(ts);

-- Kart yönetimi ayrı bir yetki: ev halkı (izleyici) kısayolları görsün ama
-- düzenleyemesin. Kartların GÖRÜNMESİ 'panel.view' ile geliyor.
INSERT INTO permissions (key, description) VALUES
  ('apps.manage', 'Uygulama kartı, kategori ve bookmark yönetimi');

INSERT INTO role_permissions (role_id, permission_key) VALUES
  (1, 'apps.manage');
`,
};
