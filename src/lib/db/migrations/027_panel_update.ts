import type { Migration } from "./types";

/**
 * Panelin kendini GitHub sürümünden güncellemesi.
 *
 * Ayrı izin, çünkü güncelleme paneli yeniden başlatıyor ve proje dizinindeki
 * kaynak dosyaları değiştiriyor: ayarları düzenleyebilen herkesin bunu
 * yapabilmesi beklenmez. Varsayılan olarak yalnızca yönetici rolünde.
 */
export const migration027: Migration = {
  version: 27,
  name: "panel_update",
  up: `
INSERT OR IGNORE INTO permissions (key, description) VALUES
  ('panel.update', 'Paneli GitHub sürümünden güncelleme (panel yeniden başlar)');

INSERT OR IGNORE INTO role_permissions (role_id, permission_key) VALUES
  (1, 'panel.update');
`,
};
