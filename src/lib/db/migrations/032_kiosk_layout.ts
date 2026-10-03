import type { Migration } from "./types";

/**
 * Kiosk bağlantısı başına gösterge paneli düzeni.
 *
 * Bir bağlantının satırı yoksa kiosk, bağlantıyı oluşturanın kendi
 * düzenini izliyor (`dashboard_widgets`). Satırlar yalnızca o bağlantı için
 * ayrı bir düzen kaydedildiğinde yazılıyor — salondaki tablet ile mutfaktaki
 * ekran farklı şeyler göstermek isteyebilir.
 */
export const migration032: Migration = {
  version: 32,
  name: "kiosk_layout",
  up: `
CREATE TABLE kiosk_widgets (
  token_hash TEXT    NOT NULL REFERENCES kiosk_tokens(token_hash) ON DELETE CASCADE,
  widget_key TEXT    NOT NULL,
  position   INTEGER NOT NULL,
  visible    INTEGER NOT NULL DEFAULT 1,
  size       TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (token_hash, widget_key)
) WITHOUT ROWID;
`,
};
