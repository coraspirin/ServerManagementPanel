import type { Migration } from "./types";

/**
 * M3.8 — güvenlik izleme.
 *
 * `vuln_scans` bir GEÇMİŞ tablosu: her tarama turu bir satır, bulgular JSON
 * olarak. Bulguları ayrı satırlara açmak cazip ama işe yaramaz — CVE listesi
 * yalnızca "şu an ne var" sorusuna cevap veriyor, tek tek sorgulanmıyor ve
 * image güncellenince tamamen değişiyor.
 *
 * `port_expectations` ise kullanıcının "bu port böyle olmalı" kaydı: envanter
 * her taramada yeniden üretiliyor, beklenti kalıcı. Beklenmedik bir port
 * açıldığında bunun anlaşılmasını sağlayan şey bu tablo.
 */
export const migration017: Migration = {
  version: 17,
  name: "security",
  up: `
CREATE TABLE vuln_scans (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           INTEGER NOT NULL DEFAULT (unixepoch()),
  image        TEXT    NOT NULL,
  scanner      TEXT    NOT NULL DEFAULT 'trivy',
  ok           INTEGER NOT NULL DEFAULT 1,
  critical     INTEGER NOT NULL DEFAULT 0,
  high         INTEGER NOT NULL DEFAULT 0,
  medium       INTEGER NOT NULL DEFAULT 0,
  low          INTEGER NOT NULL DEFAULT 0,
  -- En ciddi bulguların özeti (JSON dizisi)
  findings     TEXT    NOT NULL DEFAULT '[]',
  duration_ms  INTEGER NOT NULL DEFAULT 0,
  error        TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX idx_vuln_ts ON vuln_scans(ts DESC);
CREATE INDEX idx_vuln_image ON vuln_scans(image, ts DESC);

CREATE TABLE port_expectations (
  -- "tcp/443" biçiminde
  key        TEXT    PRIMARY KEY,
  port       INTEGER NOT NULL,
  protocol   TEXT    NOT NULL,
  note       TEXT    NOT NULL DEFAULT '',
  -- Kullanıcı bu portu bilerek açık bıraktı mı
  expected   INTEGER NOT NULL DEFAULT 1,
  first_seen INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
) WITHOUT ROWID;

CREATE TABLE port_forwards (
  -- UPnP/IGD'den okunan yönlendirmeler; "tcp/8123" biçiminde
  key          TEXT    PRIMARY KEY,
  protocol     TEXT    NOT NULL,
  external_port INTEGER NOT NULL,
  internal_port INTEGER NOT NULL,
  internal_host TEXT    NOT NULL DEFAULT '',
  description  TEXT    NOT NULL DEFAULT '',
  -- Kullanıcının notu: "bu ne, hâlâ gerekli mi"
  note         TEXT    NOT NULL DEFAULT '',
  acknowledged INTEGER NOT NULL DEFAULT 0,
  first_seen   INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen    INTEGER NOT NULL DEFAULT (unixepoch())
) WITHOUT ROWID;
`,
};
