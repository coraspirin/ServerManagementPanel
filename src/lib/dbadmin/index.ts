import "server-only";

import { onHost } from "@/lib/hosts/on-host";
import { getNumber } from "@/lib/settings";
import { serverT } from "@/lib/i18n/runtime";
import {
  mysqlQuery,
  mysqlStructure,
  mysqlTables,
  parseKeyspace,
  pgQuery,
  pgStructure,
  pgTables,
  redisKeyspace,
  redisQuery,
  toQueryResult,
  type NetConfig,
  type RawRunner,
} from "./drivers/network";
import { execQuery, execRaw } from "./exec/runner";
import { sqliteRun, sqliteStructure, sqliteTables, toResult } from "./drivers/sqlite";
import { analyzeSql, applyLimit } from "./sql-guard";
import type { ConnectionSecrets } from "./store";
import type { DbStructure, DbTable, QueryResult } from "./types";

/**
 * M3.6 — motorları tek arayüz altında toplayan katman.
 *
 * KORUMA BURADA, sürücülerde değil: salt-okunur kontrolü, satır limiti,
 * zaman aşımı ve tehlikeli ifade tespiti tek bir yerde. Yeni bir motor
 * eklendiğinde bu korumaları yeniden yazmak gerekmiyor — ve unutmak da
 * mümkün olmuyor.
 */

function netConfig(connection: ConnectionSecrets): NetConfig {
  return {
    host: connection.host,
    port: connection.port,
    username: connection.username,
    password: connection.password,
    database: connection.database,
    timeoutMs: getNumber("dbadmin.timeout_seconds") * 1000,
  };
}

export type RunOptions = {
  /** Kullanıcı tehlikeli ifadeyi açıkça onayladı mı. */
  confirmed?: boolean;
};

export type RunOutcome =
  | { ok: true; result: QueryResult }
  | { ok: false; error: string; needsConfirmation?: boolean; dangers?: string[] };

export async function localRunQuery(
  connection: ConnectionSecrets,
  sql: string,
  options: RunOptions = {},
): Promise<RunOutcome> {
  const trimmed = sql.trim();
  if (trimmed.length === 0) return { ok: false, error: serverT("dbadmin.emptyQuery") };

  const analysis = analyzeSql(trimmed);

  // Tek istekte birden çok ifade: bir SQL enjeksiyonunu zararsızdan yıkıcıya
  // çeviren şey tam olarak budur. Sürücü seviyesinde de kapalı ama burada
  // açıkça reddediliyor ki kullanıcı sebebini görsün.
  if (analysis.statementCount > 1) {
    return {
      ok: false,
      error: serverT("dbadmin.singleStatement"),
    };
  }

  const writes = analysis.kind === "write" || analysis.kind === "schema";

  if (writes && !connection.writable) {
    return {
      ok: false,
      error: serverT("dbadmin.readOnly", { name: connection.name }),
    };
  }

  if (analysis.dangers.length > 0 && !options.confirmed) {
    return {
      ok: false,
      error: serverT("dbadmin.needsConfirm"),
      needsConfirmation: true,
      dangers: analysis.dangers,
    };
  }

  const limit = getNumber("dbadmin.max_rows");
  const finalSql =
    analysis.kind === "read" ? applyLimit(trimmed, connection.engine, limit) : trimmed;

  const started = Date.now();

  try {
    if (viaExec(connection)) {
      const raw = await execQuery(connection, finalSql, writes);
      return { ok: true, result: toQueryResult(raw, Date.now() - started, limit) };
    }
    switch (connection.engine) {
      case "sqlite": {
        const raw = await sqliteRun(connection.host, finalSql, writes);
        return { ok: true, result: toResult(raw, Date.now() - started, limit) };
      }
      case "postgres": {
        const raw = await pgQuery(netConfig(connection), finalSql);
        return { ok: true, result: toQueryResult(raw, Date.now() - started, limit) };
      }
      case "mysql": {
        const raw = await mysqlQuery(netConfig(connection), finalSql);
        return { ok: true, result: toQueryResult(raw, Date.now() - started, limit) };
      }
      case "redis": {
        const raw = await redisQuery(netConfig(connection), finalSql);
        return { ok: true, result: toQueryResult(raw, Date.now() - started, limit) };
      }
      default:
        return { ok: false, error: serverT("dbadmin.unknownEngine") };
    }
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

/**
 * Envanterdeki sunucular (docker/native) sürücüyle değil istemci CLI'ıyla
 * okunur (bkz. `exec/runner.ts`). Bu iş MERKEZDE yapılır: Docker sağlayıcısı
 * seçili sunucuya kendisi yönlendiriyor, ajana ayrıca op gerekmiyor.
 */
function viaExec(connection: ConnectionSecrets): boolean {
  return connection.transport === "docker" || connection.transport === "native";
}

function execRunner(connection: ConnectionSecrets): RawRunner {
  return (sql) => execQuery(connection, sql, false);
}

async function execListTables(connection: ConnectionSecrets): Promise<DbTable[]> {
  switch (connection.engine) {
    case "postgres":
      return pgTables(execRunner(connection));
    case "mysql": {
      const tables = await mysqlTables(execRunner(connection));
      // Envanterde bir veritabanı seçiliyse yalnız onun tabloları.
      return connection.database ? tables.filter((table) => table.schema === connection.database) : tables;
    }
    case "redis": {
      const { stdout } = await execRaw(connection, "INFO keyspace");
      return parseKeyspace(stdout);
    }
    default:
      return [];
  }
}

export async function localListTables(connection: ConnectionSecrets): Promise<DbTable[]> {
  if (viaExec(connection)) return execListTables(connection);
  switch (connection.engine) {
    case "sqlite":
      return sqliteTables(connection.host);
    case "postgres":
      return pgTables(netConfig(connection));
    case "mysql":
      return mysqlTables(netConfig(connection));
    case "redis":
      return redisKeyspace(netConfig(connection));
    default:
      return [];
  }
}

export async function localTableStructure(
  connection: ConnectionSecrets,
  schema: string,
  table: string,
): Promise<DbStructure> {
  if (viaExec(connection) && connection.engine === "postgres") {
    return pgStructure(execRunner(connection), schema, table);
  }
  if (viaExec(connection) && connection.engine === "mysql") {
    return mysqlStructure(execRunner(connection), schema, table);
  }
  switch (connection.engine) {
    case "sqlite":
      return sqliteStructure(connection.host, table);
    case "postgres":
      return pgStructure(netConfig(connection), schema, table);
    case "mysql":
      return mysqlStructure(netConfig(connection), schema, table);
    default:
      return { columns: [], indexes: [], foreignKeys: [], createSql: null };
  }
}

/** Bağlantıyı sınar; hata mesajı kullanıcıya olduğu gibi gösterilir. */
export async function localTestConnection(
  connection: ConnectionSecrets,
): Promise<{ ok: boolean; message: string }> {
  try {
    const probe =
      connection.engine === "redis"
        ? "PING"
        : connection.engine === "sqlite"
          ? "SELECT 1 AS ok"
          : "SELECT 1";

    const outcome = await runQuery(connection, probe);
    if (!outcome.ok) return { ok: false, message: outcome.error };

    const tables = await listTables(connection);
    return {
      ok: true,
      message: serverT("dbadmin.testOk", { count: tables.length }),
    };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

/**
 * Tablo verisini sayfalı okur.
 *
 * Tablo ve sütun adları kullanıcıdan değil VERİTABANININ KENDİSİNDEN geliyor
 * (listTables/structure çıktısı), ama yine de tırnaklanıyor: adında boşluk ya
 * da ayrılmış sözcük geçen bir tablo aksi halde sözdizimi hatası verirdi.
 */
export async function localReadTable(
  connection: ConnectionSecrets,
  schema: string,
  table: string,
  options: { limit: number; offset: number; orderBy?: string; desc?: boolean; filter?: string },
): Promise<RunOutcome> {
  if (connection.engine === "redis") {
    return runQuery(connection, `KEYS *`);
  }

  const quote = connection.engine === "mysql" ? "`" : '"';
  const wrap = (value: string) => `${quote}${value.replaceAll(quote, quote + quote)}${quote}`;

  const qualified =
    connection.engine === "sqlite" ? wrap(table) : `${wrap(schema)}.${wrap(table)}`;

  let sql = `SELECT * FROM ${qualified}`;
  if (options.filter && options.filter.trim().length > 0) {
    // Serbest WHERE metni: kullanıcı SQL yazıyor ve bunu biliyor. Yazma
    // koruması yine devrede — bu bir SELECT.
    sql += ` WHERE ${options.filter.trim()}`;
  }
  if (options.orderBy) {
    sql += ` ORDER BY ${wrap(options.orderBy)} ${options.desc ? "DESC" : "ASC"}`;
  }
  sql += ` LIMIT ${Math.max(1, options.limit)} OFFSET ${Math.max(0, options.offset)}`;

  return runQuery(connection, sql);
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("ECONNREFUSED")) {
    return serverT("dbadmin.refused");
  }
  if (message.includes("ETIMEDOUT") || message.includes("timeout")) {
    return serverT("dbadmin.timeout");
  }
  if (message.includes("ENOTFOUND") || message.includes("EAI_AGAIN")) {
    return serverT("dbadmin.notFound");
  }
  return message.slice(0, 600);
}

// --- Çoklu sunucu -------------------------------------------------------------
//
// Veritabanına SEÇİLİ SUNUCUDAN bağlanılır: uzak sunucudaki bir container adı
// (`postgres`) merkezden çözülmez, SQLite dosyası da o sunucunun diskinde.
// Uzak sunucuda iş, bağlantı bilgisiyle birlikte ajana yaptırılır; koruma
// (salt-okunur kontrolü, limit, zaman aşımı) ajanda aynı kodla uygulanır.

export function runQuery(
  connection: ConnectionSecrets,
  sql: string,
  options: RunOptions = {},
): Promise<RunOutcome> {
  if (viaExec(connection)) return localRunQuery(connection, sql, options);
  return onHost("db.query", [connection, sql, options], () => localRunQuery(connection, sql, options));
}

export function listTables(connection: ConnectionSecrets): Promise<DbTable[]> {
  if (viaExec(connection)) return execListTables(connection);
  return onHost("db.tables", [connection], () => localListTables(connection));
}

export function tableStructure(
  connection: ConnectionSecrets,
  schema: string,
  table: string,
): Promise<DbStructure> {
  if (viaExec(connection)) return localTableStructure(connection, schema, table);
  return onHost("db.structure", [connection, schema, table], () =>
    localTableStructure(connection, schema, table),
  );
}

export function testConnection(connection: ConnectionSecrets): Promise<{ ok: boolean; message: string }> {
  if (viaExec(connection)) return localTestConnection(connection);
  return onHost("db.test", [connection], () => localTestConnection(connection));
}

export function readTable(
  connection: ConnectionSecrets,
  schema: string,
  table: string,
  options: Parameters<typeof localReadTable>[3],
): ReturnType<typeof localReadTable> {
  if (viaExec(connection)) return localReadTable(connection, schema, table, options);
  return onHost("db.read", [connection, schema, table, options], () =>
    localReadTable(connection, schema, table, options),
  );
}
