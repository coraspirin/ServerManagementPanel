import type { Migration } from "./types";

/**
 * M1.10 — pahalı sonuçların saklandığı basit önbellek.
 *
 * Image güncelleme kontrolü kayıt defterine ağ isteği atar ve saniyeler
 * sürer; her sayfa açılışında yapılamaz. Sonuç bellekte tutulsaydı panel her
 * yeniden başlatıldığında kaybolurdu ve kontrol günde bir çalıştığı için
 * ekran bir güne kadar boş kalabilirdi.
 *
 * Ayrı ayrı tablolar yerine tek bir anahtar/değer tablosu: saklanan şey
 * sorgulanmıyor, bütün olarak yazılıp bütün olarak okunuyor. Sorgulanması
 * gereken bir veri çıkarsa kendi tablosunu hak eder.
 */
export const migration008: Migration = {
  version: 8,
  name: "cache",
  up: `
CREATE TABLE cache (
  key        TEXT    PRIMARY KEY,
  value      TEXT    NOT NULL,          -- JSON
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;
`,
};
