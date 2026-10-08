import type { Migration } from "./types";

/**
 * Veritabanı envanteri — sunucudaki DB sunucuları kendiliğinden bulunur.
 *
 * `transport`: tcp (elle girilen adres) | docker (DB container'ının içinde
 * `docker exec` ile istemci) | native (host'a kurulu servis; panel imajından
 * geçici container, soket bağlanır). Docker ve native'de panelin DB'ye ağdan
 * ulaşması gerekmiyor — eskiden içe aktarılan container'lar ayrı Docker
 * ağında olduğu için ENOTFOUND veriyordu.
 *
 * `instance_key`: envanterin bulduğu sunucunun sabit anahtarı
 * (`docker:<ad>`, `native:mysql:/run/mysqld/mysqld.sock` …). Elle eklenen
 * bağlantıda boş.
 *
 * `meta_json`: native için soket yolu, postgres uid'i gibi çalışma bilgisi.
 *
 * `name` 016'dan beri tablo genelinde UNIQUE ve tablo yeniden kurulmadan
 * kaldırılamıyor (yeniden kurmak FK'ler yüzünden geçmişi silerdi). Envanter
 * satırları bu yüzden benzersiz bir iç adla tutuluyor; arayüz adı
 * container/servis adından üretiyor.
 */
export const migration034: Migration = {
  version: 34,
  name: "dbadmin_inventory",
  up: `
ALTER TABLE db_connections ADD COLUMN transport TEXT NOT NULL DEFAULT 'tcp';
ALTER TABLE db_connections ADD COLUMN instance_key TEXT NOT NULL DEFAULT '';
ALTER TABLE db_connections ADD COLUMN meta_json TEXT NOT NULL DEFAULT '{}';

CREATE UNIQUE INDEX idx_db_connections_instance
  ON db_connections(host_id, instance_key) WHERE instance_key <> '';

-- Eskiden içe aktarılan container'lar artık container'ın içinden çalışıyor.
UPDATE db_connections
   SET transport = 'docker', instance_key = 'docker:' || container
 WHERE source = 'docker' AND container <> '' AND engine <> 'sqlite'
   AND id IN (SELECT MIN(id) FROM db_connections
              WHERE source = 'docker' AND container <> '' AND engine <> 'sqlite'
              GROUP BY host_id, container);
`,
};
