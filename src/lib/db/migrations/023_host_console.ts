import type { Migration } from "./types";

/**
 * Sunucu konsolu — hazır kalıplar ve serbest komut.
 *
 * Tek bir izin var (`host.shell`), hazır kalıplar ile serbest komut için ayrı
 * ayrı değil. Sebebi projenin baştan beri savunduğu ayrım: paneldeki RBAC
 * "kim neyi görsün" sorusunu çözer, gerçek sınır host'taki
 * `/etc/panel-helper/allow.conf`'tur. Kalıpları açıp serbest komutu kapalı
 * tutmak orada yapılır ve panel o kararı değiştiremez. Aynı ayrımı bir de
 * burada taklit etmek, güvenlik veriyormuş gibi görünen ama vermeyen ikinci
 * bir düğme olurdu.
 *
 * `host.power` gibi bu izin de admin dışında kimseye otomatik verilmez.
 */
export const migration023: Migration = {
  version: 23,
  name: "host_console",
  up: `
INSERT OR IGNORE INTO permissions (key, description) VALUES
  ('host.shell', 'Sunucu konsolunu kullanma: hazır komut kalıpları ve serbest komut');

INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
VALUES (1, 'host.shell');
`,
};
