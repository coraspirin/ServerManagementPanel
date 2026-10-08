import "server-only";

import { credentialsFromEnv } from "@/lib/backup/discover";
import { panelContainerName } from "@/lib/host/self";
import { serverT } from "@/lib/i18n/runtime";
import { getDockerProvider } from "@/lib/providers";
import { engineOf } from "../discovery";
import {
  connectionSecrets,
  listConnections,
  pruneInstances,
  upsertInstance,
  type ConnectionSecrets,
  type InstanceRecord,
} from "../store";
import { DEFAULT_PORT, type DbConnection, type InventoryDatabase, type InventoryInstance } from "../types";
import { discoverNative } from "./native";
import { execQuery, execRaw } from "./runner";
import { scanSqliteFiles, type SqliteFile } from "./sqlite-scan";

/**
 * Seçili sunucudaki TÜM veritabanı sunucuları: Docker container'ları (imaj
 * adından) ve host'a kurulu servisler (soket/systemd). Her biri bir bağlantı
 * satırına eşlenir (sorgu ekranı, geçmiş ve yetki bayrağı onu kullanıyor),
 * sonra içindeki veritabanları boyutlarıyla okunur.
 *
 * Bir sunucunun hatası diğerlerini durdurmaz; hata o satırda gösterilir.
 * Keşfin kendisi başarısız olursa (Docker'a ulaşılamadı, ajan eski) bu da
 * `errors` ile döner — "hiç veritabanı yok" ile karıştırılmasın.
 */

type Found = InstanceRecord & {
  transport: "docker" | "native"; label: string; image: string; running: boolean; env: Record<string, string> };

const MYSQL_SYSTEM = new Set(["information_schema", "performance_schema", "mysql", "sys"]);

function envMap(env: string[] | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of env ?? []) {
    const index = entry.indexOf("=");
    if (index > 0) map[entry.slice(0, index)] = entry.slice(index + 1);
  }
  return map;
}

function describe(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 400);
}

async function findDocker(errors: string[]): Promise<Found[] | null> {
  const provider = getDockerProvider();
  let containers;
  try {
    containers = await provider.list(true);
  } catch (error) {
    errors.push(serverT("dbadmin.inventory.dockerFailed", { error: describe(error) }));
    return null;
  }

  const found: Found[] = [];
  for (const container of containers) {
    const engine = engineOf(container.image);
    if (!engine || engine === "sqlite") continue;
    if (container.name === panelContainerName()) continue;

    let env: Record<string, string> = {};
    try {
      const raw = (await provider.inspectRaw(container.id)) as { Config?: { Env?: string[] } } | null;
      env = envMap(raw?.Config?.Env);
    } catch {
      // Env okunamazsa kimlik "eksik" görünür; sunucu yine listelenir.
    }

    found.push({
      key: `docker:${container.name}`,
      engine,
      transport: "docker",
      container: container.name,
      host: container.name,
      port: DEFAULT_PORT[engine],
      meta: {},
      label: container.name,
      image: container.image,
      running: container.state === "running",
      env,
    });
  }
  return found;
}

async function findNative(errors: string[]): Promise<Found[] | null> {
  try {
    const instances = await discoverNative();
    return instances.map((instance) => ({
      key: instance.key,
      engine: instance.engine,
      transport: "native" as const,
      container: "",
      host: instance.meta.socket ?? "127.0.0.1",
      port: instance.port,
      meta: instance.meta,
      label: instance.meta.service ?? instance.engine,
      image: "",
      running: !instance.meta.stopped,
      env: {},
    }));
  } catch (error) {
    const message = describe(error);
    // Eski ajanda `db.native` op'u yok.
    errors.push(
      message.includes("unknown-op")
        ? serverT("dbadmin.agentOutdated")
        : serverT("dbadmin.inventory.nativeFailed", { error: message }),
    );
    return null;
  }
}

function credentialState(found: Found, connection: DbConnection): InventoryInstance["credentials"] {
  if (connection.username || connection.hasPassword) return "manual";
  if (found.transport === "native") return "auto";
  if (found.engine === "mysql") return credentialsFromEnv("mysql", found.env) ? "auto" : "missing";
  return "auto";
}

export async function listDatabases(connection: ConnectionSecrets): Promise<InventoryDatabase[]> {
  if (connection.engine === "mysql") {
    const raw = await execQuery(
      { ...connection, database: "" },
      `SELECT s.SCHEMA_NAME AS name,
              SUM(COALESCE(t.DATA_LENGTH, 0) + COALESCE(t.INDEX_LENGTH, 0)) AS size,
              COUNT(t.TABLE_NAME) AS tables
       FROM information_schema.SCHEMATA s
       LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = s.SCHEMA_NAME
       GROUP BY s.SCHEMA_NAME
       ORDER BY s.SCHEMA_NAME`,
      false,
    );
    return raw.rows.map((row) => {
      const name = String(row[0]);
      return {
        name,
        sizeBytes: row[1] === null ? null : Number(row[1]),
        tables: row[2] === null ? null : Number(row[2]),
        system: MYSQL_SYSTEM.has(name),
      };
    });
  }

  if (connection.engine === "postgres") {
    const raw = await execQuery(
      { ...connection, database: "" },
      `SELECT datname,
              CASE WHEN has_database_privilege(datname, 'CONNECT') THEN pg_database_size(datname) END
       FROM pg_database
       WHERE NOT datistemplate
       ORDER BY datname`,
      false,
    );
    return raw.rows.map((row) => ({
      name: String(row[0]),
      sizeBytes: row[1] === null ? null : Number(row[1]),
      tables: null,
      system: String(row[0]) === "postgres",
    }));
  }

  if (connection.engine === "redis") {
    const { stdout } = await execRaw({ ...connection, database: "" }, "INFO keyspace");
    const databases: InventoryDatabase[] = [];
    for (const line of stdout.split("\n")) {
      const match = line.match(/^db(\d+):keys=(\d+)/);
      if (match) databases.push({ name: `db${match[1]}`, sizeBytes: null, tables: Number(match[2]), system: false });
    }
    return databases;
  }

  return [];
}

async function runningContainers(): Promise<string[]> {
  try {
    return (await getDockerProvider().list(false)).map((container) => container.name);
  } catch {
    return [];
  }
}

async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function findSqlite(errors: string[]): Promise<SqliteFile[] | null> {
  try {
    return await scanSqliteFiles();
  } catch (error) {
    errors.push(serverT("dbadmin.inventory.sqliteFailed", { error: describe(error) }));
    return null;
  }
}

/**
 * SQLite dosyaları container'a göre gruplanır: ağaçta container bir "sunucu",
 * dosyaları onun veritabanları. Her dosya kendi bağlantı satırı — sorgu
 * ekranı, geçmiş ve yazma bayrağı dosya başına.
 */
function sqliteGroups(files: SqliteFile[], running: Set<string>): InventoryInstance[] {
  const byContainer = new Map<string, SqliteFile[]>();
  for (const file of files) {
    byContainer.set(file.container, [...(byContainer.get(file.container) ?? []), file]);
  }
  const connections = new Map(
    listConnections()
      .filter((connection) => connection.instanceKey.startsWith("sqlite:"))
      .map((connection) => [connection.instanceKey, connection.id]),
  );

  return [...byContainer].map(([container, entries]) => ({
    connectionId: 0,
    key: `sqlite-group:${container}`,
    label: container,
    engine: "sqlite" as const,
    transport: "docker" as const,
    container,
    image: "",
    // Dosya container dursa da okunabiliyor; "durdu" yalnız bilgi.
    state: running.has(container) ? ("running" as const) : ("stopped" as const),
    credentials: "auto" as const,
    databases: entries
      .sort((a, b) => a.containerPath.localeCompare(b.containerPath))
      .map((file) => ({
        name: file.containerPath,
        sizeBytes: file.sizeBytes,
        tables: null,
        system: false,
        connectionId: connections.get(`sqlite:${file.hostPath}`),
        path: file.hostPath,
      })),
    error: "",
  }));
}

export async function buildInventory(): Promise<{ instances: InventoryInstance[]; errors: string[] }> {
  const errors: string[] = [];
  const [docker, native, sqlite] = await Promise.all([findDocker(errors), findNative(errors), findSqlite(errors)]);
  const found = [...(docker ?? []), ...(native ?? [])];

  for (const entry of found) upsertInstance(entry);
  for (const file of sqlite ?? []) {
    upsertInstance({
      key: `sqlite:${file.hostPath}`,
      engine: "sqlite",
      transport: "tcp",
      container: file.container,
      host: file.hostPath,
      port: 0,
      meta: {},
    });
  }
  // Keşif yarım kaldıysa o türün bulunamayanları silinmez: Docker'a bir anlık
  // ulaşılamadı diye kayıtlar (ve geçmişleri) gitmesin.
  const scanned = [
    ...(docker ? ["docker:"] : []),
    ...(native ? ["native:"] : []),
    ...(sqlite ? ["sqlite:"] : []),
  ];
  pruneInstances(
    [...found.map((entry) => entry.key), ...(sqlite ?? []).map((file) => `sqlite:${file.hostPath}`)],
    scanned,
  );

  const connections = new Map(
    listConnections()
      .filter((connection) => connection.instanceKey)
      .map((connection) => [connection.instanceKey, connection]),
  );

  const instances = await mapLimit(found, 4, async (entry): Promise<InventoryInstance> => {
    const connection = connections.get(entry.key);
    const base: InventoryInstance = {
      connectionId: connection?.id ?? 0,
      key: entry.key,
      label: entry.label,
      engine: entry.engine,
      transport: entry.transport,
      container: entry.container,
      image: entry.image,
      state: entry.running ? "running" : "stopped",
      credentials: connection ? credentialState(entry, connection) : "missing",
      databases: [],
      error: "",
    };
    if (!connection || !entry.running) return base;

    const secrets = connectionSecrets(connection.id);
    if (!secrets) return { ...base, error: serverT("api.db.connectionOrPasswordMaster") };
    try {
      return { ...base, databases: await listDatabases(secrets) };
    } catch (error) {
      return { ...base, error: describe(error) };
    }
  });

  const running = new Set(await runningContainers());
  const all = [...instances, ...sqliteGroups(sqlite ?? [], running)];

  // Önce DB sunucuları, sonra SQLite grupları; her birinde çalışanlar önce.
  all.sort(
    (a, b) =>
      Number(a.engine === "sqlite") - Number(b.engine === "sqlite") ||
      Number(b.state === "running") - Number(a.state === "running") ||
      a.label.localeCompare(b.label),
  );
  return { instances: all, errors };
}
