import "server-only";

import { getDockerProvider } from "@/lib/providers";
import { DEFAULT_PORT, type DbEngine } from "./types";
import { createConnection, listConnections } from "./store";

/**
 * M3.6 — Docker container'larından veritabanı keşfi.
 *
 * Motor imaj adından tanınıyor, bağlantı bilgileri container'ın ortam
 * değişkenlerinden ÖNERİLİYOR. "Öneri" kelimesi önemli: parola env'de
 * bulunursa doldurulur ama keşif hiçbir zaman kendiliğinden bağlanmaz —
 * kullanıcı bağlantıyı görür, gerekiyorsa düzeltir ve kendisi sınar.
 *
 * Keşfedilen kayıt YAZILAMAZ olarak başlar. Bir üretim veritabanına, sırf
 * panel onu bulabildi diye, yazma yetkisiyle bağlanmak yanlış olurdu.
 */

type EngineMatch = { engine: DbEngine; patterns: RegExp[] };

const MATCHERS: EngineMatch[] = [
  { engine: "postgres", patterns: [/postgres/i, /timescale/i, /pgvector/i] },
  { engine: "mysql", patterns: [/mysql/i, /mariadb/i, /percona/i] },
  { engine: "redis", patterns: [/redis/i, /valkey/i, /keydb/i] },
];

function engineOf(image: string): DbEngine | null {
  for (const matcher of MATCHERS) {
    if (matcher.patterns.some((pattern) => pattern.test(image))) return matcher.engine;
  }
  return null;
}

/** Container env listesini ("A=B") sözlüğe çevirir. */
function envMap(env: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of env) {
    const index = entry.indexOf("=");
    if (index > 0) map[entry.slice(0, index)] = entry.slice(index + 1);
  }
  return map;
}

function suggest(engine: DbEngine, env: Record<string, string>) {
  if (engine === "postgres") {
    return {
      username: env.POSTGRES_USER ?? env.PGUSER ?? "postgres",
      password: env.POSTGRES_PASSWORD ?? env.PGPASSWORD ?? "",
      database: env.POSTGRES_DB ?? env.PGDATABASE ?? "postgres",
    };
  }
  if (engine === "mysql") {
    return {
      username: env.MYSQL_USER ?? env.MARIADB_USER ?? "root",
      password:
        env.MYSQL_PASSWORD ??
        env.MARIADB_PASSWORD ??
        env.MYSQL_ROOT_PASSWORD ??
        env.MARIADB_ROOT_PASSWORD ??
        "",
      database: env.MYSQL_DATABASE ?? env.MARIADB_DATABASE ?? "",
    };
  }
  return { username: "", password: env.REDIS_PASSWORD ?? "", database: "" };
}

export type Discovered = {
  container: string;
  engine: DbEngine;
  host: string;
  port: number;
  alreadyKnown: boolean;
};

export async function discoverDatabases(): Promise<Discovered[]> {
  const provider = getDockerProvider();
  const known = new Set(
    listConnections()
      .filter((connection) => connection.container.length > 0)
      .map((connection) => connection.container),
  );

  const found: Discovered[] = [];

  let containers;
  try {
    containers = await provider.list(true);
  } catch {
    return found;
  }

  for (const container of containers) {
    const engine = engineOf(container.image);
    if (!engine) continue;

    found.push({
      container: container.name,
      engine,
      // Container ADIYLA bağlanılıyor, IP ile değil: panel ve veritabanı aynı
      // Docker ağındaysa ad kalıcı, IP her yeniden başlatmada değişebilir.
      host: container.name,
      port: DEFAULT_PORT[engine],
      alreadyKnown: known.has(container.name),
    });
  }

  return found;
}

export async function importDiscovered(container: string): Promise<{ ok: boolean; error?: string }> {
  const provider = getDockerProvider();

  let raw;
  try {
    raw = (await provider.inspectRaw(container)) as {
      Config?: { Image?: string; Env?: string[] };
    } | null;
  } catch {
    return { ok: false, error: "Container incelenemedi." };
  }

  const image = raw?.Config?.Image ?? "";
  const engine = engineOf(image);
  if (!engine) return { ok: false, error: "Bu container'da tanınan bir veritabanı yok." };

  const env = envMap(raw?.Config?.Env ?? []);
  const proposal = suggest(engine, env);

  const existing = listConnections().find((connection) => connection.container === container);
  if (existing) return { ok: false, error: "Bu container zaten ekli." };

  createConnection(
    {
      name: container,
      engine,
      host: container,
      port: DEFAULT_PORT[engine],
      username: proposal.username,
      password: proposal.password,
      database: proposal.database,
      // Keşif hiçbir zaman yazma yetkisiyle başlamaz.
      writable: false,
    },
    "docker",
    container,
  );

  return { ok: true };
}
