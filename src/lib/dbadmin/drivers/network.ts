import "server-only";

import net from "node:net";
import type { DbStructure, DbTable, QueryResult } from "../types";

/**
 * M3.6 — ağ üzerinden erişilen motorlar: PostgreSQL, MySQL/MariaDB, Redis.
 *
 * `pg` ve `mysql2` dinamik import ediliyor. Sebep pratik: bu panelin
 * kurulduğu makinede hiç PostgreSQL ya da MySQL olmayabilir ve o durumda
 * kütüphanenin açılış maliyetini ödemenin anlamı yok. Ayrıca bir sürücü
 * bozulursa yalnızca kendi motorunu düşürür, tüm veritabanı ekranını değil.
 *
 * Redis için bağımlılık yok: RESP protokolü bu kullanım için (birkaç komut,
 * tek bağlantı) elli satır. Bir istemci kütüphanesi eklemek, kullanılmayan
 * bağlantı havuzu ve küme desteğini de beraberinde getirirdi.
 */

export type NetConfig = {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  timeoutMs: number;
};

type Raw = { columns: string[]; rows: unknown[][]; affected: number | null };

/* --- PostgreSQL --- */

async function pgClient(config: NetConfig) {
  const { Client } = await import("pg");
  const client = new Client({
    host: config.host,
    port: config.port,
    user: config.username,
    password: config.password,
    database: config.database || "postgres",
    connectionTimeoutMillis: config.timeoutMs,
    // Sorgunun kendisi de sınırlı: kazayla açılan devasa bir sorgu bağlantıyı
    // süresiz tutmasın.
    statement_timeout: config.timeoutMs,
    ssl: false,
  });
  await client.connect();
  return client;
}

export async function pgQuery(config: NetConfig, sql: string): Promise<Raw> {
  const client = await pgClient(config);
  try {
    const result = await client.query({ text: sql, rowMode: "array" });
    return {
      columns: (result.fields ?? []).map((field) => field.name),
      rows: (result.rows ?? []) as unknown[][],
      affected: result.command === "SELECT" ? null : (result.rowCount ?? 0),
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function pgTables(config: NetConfig): Promise<DbTable[]> {
  const result = await pgQuery(
    config,
    `SELECT n.nspname, c.relname,
            CASE c.relkind WHEN 'v' THEN 'view' ELSE 'table' END AS kind,
            c.reltuples::bigint AS approx_rows,
            pg_total_relation_size(c.oid) AS size_bytes
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r','v','p')
       AND n.nspname NOT IN ('pg_catalog','information_schema')
     ORDER BY n.nspname, c.relname`,
  );

  return result.rows.map((row) => ({
    schema: String(row[0]),
    name: String(row[1]),
    kind: String(row[2]) === "view" ? "view" : "table",
    // reltuples bir TAHMİN (son ANALYZE'daki değer). Kesin sayı için her
    // tabloya COUNT(*) atmak gerekirdi; ağaç görünümü için tahmin yeter.
    rowCount: Number(row[3]) < 0 ? null : Number(row[3]),
    sizeBytes: Number(row[4]),
  }));
}

export async function pgStructure(
  config: NetConfig,
  schema: string,
  table: string,
): Promise<DbStructure> {
  const columns = await pgQuery(
    config,
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = ${literal(schema)} AND table_name = ${literal(table)}
     ORDER BY ordinal_position`,
  );

  const keys = await pgQuery(
    config,
    `SELECT kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
     WHERE tc.constraint_type = 'PRIMARY KEY'
       AND tc.table_schema = ${literal(schema)} AND tc.table_name = ${literal(table)}`,
  );
  const primary = new Set(keys.rows.map((row) => String(row[0])));

  const indexes = await pgQuery(
    config,
    `SELECT i.relname, ix.indisunique,
            array_to_string(array_agg(a.attname ORDER BY a.attnum), ',')
     FROM pg_class t
     JOIN pg_namespace n ON n.oid = t.relnamespace
     JOIN pg_index ix ON t.oid = ix.indrelid
     JOIN pg_class i ON i.oid = ix.indexrelid
     JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
     WHERE n.nspname = ${literal(schema)} AND t.relname = ${literal(table)}
     GROUP BY i.relname, ix.indisunique`,
  );

  const fks = await pgQuery(
    config,
    `SELECT kcu.column_name, ccu.table_name, ccu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON kcu.constraint_name = tc.constraint_name
     JOIN information_schema.constraint_column_usage ccu
       ON ccu.constraint_name = tc.constraint_name
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND tc.table_schema = ${literal(schema)} AND tc.table_name = ${literal(table)}`,
  );

  return {
    columns: columns.rows.map((row) => ({
      name: String(row[0]),
      type: String(row[1]),
      nullable: String(row[2]) === "YES",
      defaultValue: row[3] === null ? null : String(row[3]),
      primaryKey: primary.has(String(row[0])),
    })),
    indexes: indexes.rows.map((row) => ({
      name: String(row[0]),
      unique: Boolean(row[1]),
      columns: String(row[2]).split(","),
    })),
    foreignKeys: fks.rows.map((row) => ({
      column: String(row[0]),
      referencesTable: String(row[1]),
      referencesColumn: String(row[2]),
    })),
    createSql: null,
  };
}

/* --- MySQL / MariaDB --- */

async function mysqlConnection(config: NetConfig) {
  const mysql = await import("mysql2/promise");
  return mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.username,
    password: config.password,
    database: config.database || undefined,
    connectTimeout: config.timeoutMs,
    // Çoklu ifade KAPALI: tek istekte birden çok komut çalıştırmak, bir SQL
    // enjeksiyonunu zararsızdan yıkıcıya çeviren şeydir.
    multipleStatements: false,
    dateStrings: true,
  });
}

export async function mysqlQuery(config: NetConfig, sql: string): Promise<Raw> {
  const connection = await mysqlConnection(config);
  try {
    const [rows, fields] = await connection.query({ sql, rowsAsArray: true });

    if (Array.isArray(rows)) {
      return {
        columns: (fields ?? []).map((field) => field.name),
        rows: rows as unknown[][],
        affected: null,
      };
    }

    const info = rows as { affectedRows?: number };
    return { columns: [], rows: [], affected: Number(info.affectedRows ?? 0) };
  } finally {
    await connection.end().catch(() => undefined);
  }
}

export async function mysqlTables(config: NetConfig): Promise<DbTable[]> {
  const result = await mysqlQuery(
    config,
    `SELECT table_schema, table_name, table_type, table_rows,
            COALESCE(data_length,0) + COALESCE(index_length,0)
     FROM information_schema.tables
     WHERE table_schema NOT IN ('mysql','information_schema','performance_schema','sys')
     ORDER BY table_schema, table_name`,
  );

  return result.rows.map((row) => ({
    schema: String(row[0]),
    name: String(row[1]),
    kind: String(row[2]).includes("VIEW") ? "view" : "table",
    rowCount: row[3] === null ? null : Number(row[3]),
    sizeBytes: Number(row[4]),
  }));
}

export async function mysqlStructure(
  config: NetConfig,
  schema: string,
  table: string,
): Promise<DbStructure> {
  const columns = await mysqlQuery(
    config,
    `SELECT column_name, column_type, is_nullable, column_default, column_key
     FROM information_schema.columns
     WHERE table_schema = ${literal(schema)} AND table_name = ${literal(table)}
     ORDER BY ordinal_position`,
  );

  const indexes = await mysqlQuery(
    config,
    `SELECT index_name, NOT non_unique, GROUP_CONCAT(column_name ORDER BY seq_in_index)
     FROM information_schema.statistics
     WHERE table_schema = ${literal(schema)} AND table_name = ${literal(table)}
     GROUP BY index_name, non_unique`,
  );

  const fks = await mysqlQuery(
    config,
    `SELECT column_name, referenced_table_name, referenced_column_name
     FROM information_schema.key_column_usage
     WHERE table_schema = ${literal(schema)} AND table_name = ${literal(table)}
       AND referenced_table_name IS NOT NULL`,
  );

  return {
    columns: columns.rows.map((row) => ({
      name: String(row[0]),
      type: String(row[1]),
      nullable: String(row[2]) === "YES",
      defaultValue: row[3] === null ? null : String(row[3]),
      primaryKey: String(row[4]) === "PRI",
    })),
    indexes: indexes.rows.map((row) => ({
      name: String(row[0]),
      unique: Number(row[1]) === 1,
      columns: String(row[2] ?? "").split(","),
    })),
    foreignKeys: fks.rows.map((row) => ({
      column: String(row[0]),
      referencesTable: String(row[1]),
      referencesColumn: String(row[2]),
    })),
    createSql: null,
  };
}

/**
 * Şema/tablo adları parametre olarak GEÇMİYOR (information_schema
 * sorgularında bunlar değer konumunda ama sürücüler arası tutarlılık için
 * elle kaçırılıyor). Yalnızca tırnak kaçırma yapılıyor ve girdi zaten
 * veritabanının kendi verdiği bir addan geliyor.
 */
function literal(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
}

/* --- Redis --- */

/**
 * Minimal RESP istemcisi. Yalnızca ihtiyaç duyulan kadarı: bağlan, kimlik
 * doğrula, komut gönder, cevabı çöz.
 */
function respEncode(args: string[]): string {
  return (
    `*${args.length}\r\n` +
    args.map((arg) => `$${Buffer.byteLength(arg)}\r\n${arg}\r\n`).join("")
  );
}

type RespValue = string | number | null | RespValue[];

function respDecode(buffer: string, offset: number): { value: RespValue; next: number } {
  const type = buffer[offset];
  const end = buffer.indexOf("\r\n", offset);
  if (end < 0) throw new Error("eksik yanıt");

  const head = buffer.slice(offset + 1, end);

  switch (type) {
    case "+":
      return { value: head, next: end + 2 };
    case "-":
      throw new Error(head);
    case ":":
      return { value: Number(head), next: end + 2 };
    case "$": {
      const length = Number(head);
      if (length < 0) return { value: null, next: end + 2 };
      return { value: buffer.slice(end + 2, end + 2 + length), next: end + 2 + length + 2 };
    }
    case "*": {
      const count = Number(head);
      if (count < 0) return { value: null, next: end + 2 };
      const items: RespValue[] = [];
      let cursor = end + 2;
      for (let index = 0; index < count; index += 1) {
        const decoded = respDecode(buffer, cursor);
        items.push(decoded.value);
        cursor = decoded.next;
      }
      return { value: items, next: cursor };
    }
    default:
      throw new Error(`bilinmeyen RESP türü: ${type}`);
  }
}

export function redisCommand(config: NetConfig, args: string[][]): Promise<RespValue[]> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.host, port: config.port });
    socket.setTimeout(config.timeoutMs);

    const commands = [...args];
    if (config.password) commands.unshift(["AUTH", config.password]);
    if (config.database) commands.unshift(["SELECT", config.database]);

    let buffer = "";
    const results: RespValue[] = [];

    socket.on("connect", () => socket.write(commands.map(respEncode).join("")));
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("Redis zaman aşımı"));
    });
    socket.on("error", reject);

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      try {
        let cursor = 0;
        results.length = 0;
        while (cursor < buffer.length && results.length < commands.length) {
          const decoded = respDecode(buffer, cursor);
          results.push(decoded.value);
          cursor = decoded.next;
        }
        if (results.length === commands.length) {
          socket.end();
          // AUTH/SELECT yanıtları çağıranı ilgilendirmiyor.
          resolve(results.slice(commands.length - args.length));
        }
      } catch (error) {
        // Yanıt henüz tam gelmemiş olabilir; hata mesajı ise gerçekten hatadır.
        if (error instanceof Error && error.message !== "eksik yanıt") {
          socket.destroy();
          reject(error);
        }
      }
    });
  });
}

export async function redisQuery(config: NetConfig, command: string): Promise<Raw> {
  const parts = command.trim().split(/\s+/).filter((part) => part.length > 0);
  if (parts.length === 0) throw new Error("Komut boş.");

  const [value] = await redisCommand(config, [parts]);

  if (Array.isArray(value)) {
    return {
      columns: ["değer"],
      rows: value.map((entry) => [entry === null ? null : String(entry)]),
      affected: null,
    };
  }

  return {
    columns: ["sonuç"],
    rows: [[value === null ? null : String(value)]],
    affected: null,
  };
}

/** Redis'te tablo yok; anahtar alanları (keyspace) tablo gibi gösteriliyor. */
export async function redisKeyspace(config: NetConfig): Promise<DbTable[]> {
  const [info] = await redisCommand(config, [["INFO", "keyspace"]]);
  const text = typeof info === "string" ? info : "";
  const tables: DbTable[] = [];

  for (const line of text.split("\n")) {
    const match = line.match(/^db(\d+):keys=(\d+)/);
    if (!match) continue;
    tables.push({
      schema: "keyspace",
      name: `db${match[1]}`,
      kind: "table",
      rowCount: Number(match[2]),
      sizeBytes: null,
    });
  }

  return tables;
}

export function toQueryResult(raw: Raw, durationMs: number, limit: number): QueryResult {
  const truncated = raw.rows.length > limit;
  return {
    columns: raw.columns,
    rows: raw.rows.slice(0, limit).map((row) =>
      row.map((value) => {
        if (value === null || value === undefined) return null;
        if (typeof value === "bigint") return Number(value);
        if (value instanceof Date) return value.toISOString();
        if (value instanceof Uint8Array) return `<${value.length} bayt ikili>`;
        if (typeof value === "object") return JSON.stringify(value);
        return value as string | number | boolean;
      }),
    ),
    rowCount: Math.min(raw.rows.length, limit),
    affected: raw.affected,
    durationMs,
    truncated,
  };
}
