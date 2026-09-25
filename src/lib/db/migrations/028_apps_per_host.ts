import type { Migration } from "./types";

/**
 * Çoklu sunucu: keşfedilen uygulama kartları sunucuya bağlı.
 *
 * 009'daki `idx_apps_container` container adını TÜM kartlarda tekil
 * tutuyordu; iki sunucuda aynı adlı container (ikisinde de `pihole`) olunca
 * ikinci sunucunun keşfi UNIQUE hatasıyla düşüyordu. Tekillik artık sunucu
 * başına. `host_id` NULL olan kartlar (elle eklenenler, çoklu sunucu öncesi
 * keşfedilenler) yerel sunucu sayılır — uygulama da aynı kuralı kullanıyor.
 */
export const migration028: Migration = {
  version: 28,
  name: "apps_per_host",
  up: `
DROP INDEX IF EXISTS idx_apps_container;
CREATE UNIQUE INDEX idx_apps_container ON apps(COALESCE(host_id, 1), container_name)
  WHERE container_name <> '';
`,
};
