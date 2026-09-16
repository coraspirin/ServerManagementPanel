import "server-only";

import { getNumber } from "@/lib/settings";
import { serverT } from "@/lib/i18n/runtime";
import {
  mysqlQuery,
  mysqlStructure,
  mysqlTables,
  pgQuery,
  pgStructure,
  pgTables,
  redisKeyspace,
  redisQuery,
  toQueryResult,
  type NetConfig,
} from "./drivers/network";
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

export async function runQuery(
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

export async function listTables(connection: ConnectionSecrets): Promise<DbTable[]> {
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

export async function tableStructure(
  connection: ConnectionSecrets,
  schema: string,
  table: string,
): Promise<DbStructure> {
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
export async function testConnection(
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
export async function readTable(
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
