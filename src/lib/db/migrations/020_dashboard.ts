import type { Migration } from "./types";

/**
 * M3.13 — kişiye özel gösterge paneli düzeni.
 *
 * Düzen KULLANICI BAŞINA tutuluyor, global ayar olarak değil: aynı paneli
 * kullanan iki kişinin ilgilendiği şeyler farklı. Ev halkından biri yalnızca
 * uygulama kartlarını, yöneten kişi ise sistem bilgisi ve bakım bölümünü
 * görmek isteyecek — birinin düzeni değiştirmesi diğerininkini bozmamalı.
 *
 * Tablo yalnızca SAPMALARI tutuyor: kaydı olmayan kullanıcı şemadaki
 * varsayılan sırayı ve görünürlüğü görür. Yeni bir widget eklendiğinde
 * herkesin satırını güncellemek gerekmez, kendiliğinden sonda belirir.
 */
export const migration020: Migration = {
  version: 20,
  name: "dashboard",
  up: `
CREATE TABLE dashboard_widgets (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  widget_key TEXT    NOT NULL,
  position   INTEGER NOT NULL,
  visible    INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, widget_key)
) WITHOUT ROWID;
`,
};
