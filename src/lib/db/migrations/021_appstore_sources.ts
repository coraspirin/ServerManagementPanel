import type { Migration } from "./types";

/**
 * M3.10 genişletmesi — dışarıdan eklenen şablon kaynakları.
 *
 * Katalog kod içinde kalmaya devam ediyor; bu tablo ONA EK. Kullanıcının
 * eklediği her kaynak Portainer biçiminde bir JSON belgesidir ve panel ondan
 * yalnızca type-1 (tek container) şablonları okur — compose YAML'ını panelin
 * kendisi üretir. Yani uzaktan çalıştırılabilir hiçbir dosya inmez; inen şey
 * veridir (imaj adı, port, volume, env).
 *
 * HAM BELGE saklanıyor, ayrıştırılmış şablonlar değil. Ayrı bir şablon tablosu
 * ilk yenilemede baştan kurulacak bir kopya olurdu; kaynak zaten tek parça bir
 * belge. Ayrıştırma bellekte, fetched_at anahtarıyla memoize ediliyor.
 *
 * Kimlik doğrulamalı kaynak DESTEKLENMİYOR: token saklamak, panelin sır
 * yönetimini üçüncü taraf bir katalog için genişletmek demekti. Herkese açık
 * kataloglar bu ihtiyacı zaten karşılıyor.
 */
export const migration021: Migration = {
  version: 21,
  name: "appstore_sources",
  up: `
CREATE TABLE appstore_sources (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  -- Aynı adresin iki kez eklenmesi katalogda çift kayıt demekti.
  url            TEXT    NOT NULL UNIQUE,
  enabled        INTEGER NOT NULL DEFAULT 1,
  -- Kaynaktan inen ham JSON. Hiç çekilmediyse boş.
  payload        TEXT    NOT NULL DEFAULT '',
  fetched_at     INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT    NOT NULL DEFAULT '',
  -- Kullanılabilen ve atlanan sablon sayilari; ekranda gösteriliyor.
  -- Atlananları saymak önemli: sessizce yutulan bir sablon, kullanicinin
  -- katalogda olmayan bir uygulamayi bosuna aramasi demek.
  template_count INTEGER NOT NULL DEFAULT 0,
  skipped_count  INTEGER NOT NULL DEFAULT 0,
  added_by       TEXT    NOT NULL DEFAULT '',
  added_at       INTEGER NOT NULL DEFAULT (unixepoch())
);
`,
};
