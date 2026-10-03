import type { Migration } from "./types";

/**
 * Gösterge paneli widget boyutu.
 *
 * NULL = katalogdaki varsayılan boyut. Sıra ve görünürlükle aynı ilke:
 * tabloda yalnızca SAPMA duruyor, katalogda varsayılan değişince boyutunu
 * hiç seçmemiş kullanıcılar yenisini görür.
 */
export const migration031: Migration = {
  version: 31,
  name: "dashboard_size",
  up: `
ALTER TABLE dashboard_widgets ADD COLUMN size TEXT;
`,
};
