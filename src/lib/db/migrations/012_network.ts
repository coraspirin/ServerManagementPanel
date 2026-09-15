import type { Migration } from "./types";

/**
 * M2.9 — ağ keşfi ve cihaz envanteri.
 */
export const migration012: Migration = {
  version: 12,
  name: "network",
  up: `
/*
  Ağda görülen cihazlar.

  Birincil anahtar MAC: IP adresi DHCP ile değişir, MAC cihazın kendisidir.
  IP ayrı bir sütun ve her taramada güncelleniyor — "bu cihaz artık şu adreste"
  bilgisi de değerli ama kimlik değil.

  known alanı kullanıcının kararı: cihazı bir kez "tanıdım" olarak
  işaretlediğinde bir daha uyarı üretmez. Bu bayrak olmadan her yeni telefon
  misafiri kalıcı bir uyarıya dönüşürdü.
*/
CREATE TABLE network_devices (
  mac         TEXT    PRIMARY KEY,
  ip          TEXT    NOT NULL DEFAULT '',
  hostname    TEXT    NOT NULL DEFAULT '',
  vendor      TEXT    NOT NULL DEFAULT '',
  -- Kullanıcının verdiği ad; boşsa hostname ya da IP gösterilir.
  label       TEXT    NOT NULL DEFAULT '',
  known       INTEGER NOT NULL DEFAULT 0,
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  -- Son taramada yanıt verdi mi (çevrimiçi/çevrimdışı ayrımı).
  online      INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

CREATE INDEX idx_network_last_seen ON network_devices(last_seen);

INSERT INTO permissions (key, description) VALUES
  ('network.manage', 'Ağ taraması, cihaz envanteri ve Wake-on-LAN');

INSERT INTO role_permissions (role_id, permission_key) VALUES
  (1, 'network.manage');
`,
};
