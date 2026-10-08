import "server-only";

import type { DbEngine } from "./types";

/**
 * Docker imaj adından veritabanı motoru (envanter, bkz. `exec/inventory.ts`).
 *
 * Aynı adı taşıyan yardımcı imajlar (exporter, yönetim arayüzü, yedekleyici)
 * veritabanı sunucusu değil; içlerinde istemci de yok.
 */

const NOT_A_SERVER = /exporter|commander|admin|insight|backup|dump|proxy|bouncer|operator/i;

type EngineMatch = { engine: DbEngine; patterns: RegExp[] };

const MATCHERS: EngineMatch[] = [
  { engine: "postgres", patterns: [/postgres/i, /timescale/i, /pgvector/i] },
  { engine: "mysql", patterns: [/mysql/i, /mariadb/i, /percona/i] },
  { engine: "redis", patterns: [/redis/i, /valkey/i, /keydb/i] },
];

export function engineOf(image: string): DbEngine | null {
  if (NOT_A_SERVER.test(image)) return null;
  for (const matcher of MATCHERS) {
    if (matcher.patterns.some((pattern) => pattern.test(image))) return matcher.engine;
  }
  return null;
}
