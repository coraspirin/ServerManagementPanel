import "server-only";
import { serverT } from "@/lib/i18n/runtime";

import { getDb } from "@/lib/db/client";
import { decryptSecret, encryptSecret, type EncryptedValue } from "@/lib/crypto";
import { DEFAULT_PORT, type DbConnection, type DbEngine } from "./types";

/** M3.6 — bağlantılar, sorgu geçmişi ve kayıtlı sorgular. */

const ENGINES = new Set<DbEngine>(["sqlite", "postgres", "mysql", "redis"]);

function readSecret(raw: string): string | null {
  if (!raw) return "";
  try {
    return decryptSecret(JSON.parse(raw) as EncryptedValue);
  } catch {
    return null;
  }
}

export function listConnections(): DbConnection[] {
  return (
    getDb()
      .prepare(
        `SELECT id, name, engine, host, port, username, password_enc, database,
                writable, source, container, last_ok_at, last_error
         FROM db_connections ORDER BY name COLLATE NOCASE`,
      )
      .all() as Record<string, string | number | null>[]
  ).map((row) => {
    const enc = String(row.password_enc ?? "");
    return {
      id: Number(row.id),
      name: String(row.name),
      engine: String(row.engine) as DbEngine,
      host: String(row.host),
      port: Number(row.port),
      username: String(row.username),
      database: String(row.database),
      hasPassword: enc.length > 0,
      passwordReadable: enc.length === 0 || readSecret(enc) !== null,
      writable: Number(row.writable) === 1,
      source: String(row.source) === "docker" ? "docker" : "manual",
      container: String(row.container),
      lastOkAt: row.last_ok_at === null ? null : Number(row.last_ok_at),
      lastError: String(row.last_error ?? ""),
    };
  });
}

export type ConnectionSecrets = DbConnection & { password: string };

export function connectionSecrets(id: number): ConnectionSecrets | null {
  const connection = listConnections().find((entry) => entry.id === id);
  if (!connection) return null;

  const row = getDb()
    .prepare("SELECT password_enc FROM db_connections WHERE id = ?")
    .get(id) as { password_enc: string } | undefined;

  const password = readSecret(String(row?.password_enc ?? ""));
  if (password === null) return null;

  return { ...connection, password };
}

export type ConnectionInput = {
  name: string;
  engine: string;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  writable: boolean;
};

export function validateConnection(input: ConnectionInput): string | null {
  if (input.name.trim().length < 2) return serverT("dbStore.name");
  if (!ENGINES.has(input.engine as DbEngine)) return serverT("dbStore.engine");

  if (input.engine === "sqlite") {
    const file = input.host.trim();
    if (!file.startsWith("/") || file.includes("..")) {
      return serverT("dbStore.sqlitePath");
    }
  } else {
    if (input.host.trim().length === 0) return serverT("dbStore.host");
    if (input.port <= 0 || input.port > 65535) return serverT("proxyStore.portRange");
  }

  return null;
}

export function createConnection(input: ConnectionInput, source = "manual", container = ""): number {
  const info = getDb()
    .prepare(
      `INSERT INTO db_connections
         (name, engine, host, port, username, password_enc, database, writable, source, container)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.name.trim(),
      input.engine,
      input.host.trim(),
      input.port || DEFAULT_PORT[input.engine as DbEngine],
      input.username.trim(),
      input.password ? JSON.stringify(encryptSecret(input.password)) : "",
      input.database.trim(),
      input.writable ? 1 : 0,
      source,
      container,
    );
  return Number(info.lastInsertRowid);
}

export function updateConnection(id: number, input: ConnectionInput): boolean {
  const db = getDb();
  const changes = db
    .prepare(
      `UPDATE db_connections
       SET name = ?, engine = ?, host = ?, port = ?, username = ?, database = ?, writable = ?
       WHERE id = ?`,
    )
    .run(
      input.name.trim(),
      input.engine,
      input.host.trim(),
      input.port || DEFAULT_PORT[input.engine as DbEngine],
      input.username.trim(),
      input.database.trim(),
      input.writable ? 1 : 0,
      id,
    ).changes;

  // Parola yalnızca yeni bir değer girildiyse değişir; boş bırakmak "aynı
  // kalsın" demek.
  if (input.password.length > 0) {
    db.prepare("UPDATE db_connections SET password_enc = ? WHERE id = ?").run(
      JSON.stringify(encryptSecret(input.password)),
      id,
    );
  }

  return Number(changes) > 0;
}

export function deleteConnection(id: number): boolean {
  return Number(getDb().prepare("DELETE FROM db_connections WHERE id = ?").run(id).changes) > 0;
}

export function markConnection(id: number, ok: boolean, error: string): void {
  getDb()
    .prepare(
      `UPDATE db_connections
       SET last_ok_at = CASE WHEN ? THEN unixepoch() ELSE last_ok_at END, last_error = ?
       WHERE id = ?`,
    )
    .run(ok ? 1 : 0, error, id);
}

/* --- Sorgu geçmişi --- */

export type HistoryEntry = {
  id: number;
  connectionId: number;
  username: string;
  sql: string;
  ts: number;
  durationMs: number;
  rowCount: number;
  ok: boolean;
  error: string;
};

export function recordQuery(entry: {
  connectionId: number;
  userId: number;
  username: string;
  sql: string;
  durationMs: number;
  rowCount: number;
  ok: boolean;
  error: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO db_query_history
         (connection_id, user_id, username, sql, duration_ms, row_count, ok, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.connectionId,
      entry.userId,
      entry.username,
      entry.sql.slice(0, 8000),
      entry.durationMs,
      entry.rowCount,
      entry.ok ? 1 : 0,
      entry.error.slice(0, 1000),
    );
}

/** Geçmiş KULLANICI BAZINDA: başkasının sorgusu (ve içindeki veri) gösterilmez. */
export function listHistory(userId: number, limit = 50): HistoryEntry[] {
  return (
    getDb()
      .prepare(
        `SELECT id, connection_id, username, sql, ts, duration_ms, row_count, ok, error
         FROM db_query_history WHERE user_id = ? ORDER BY ts DESC, id DESC LIMIT ?`,
      )
      .all(userId, limit) as Record<string, string | number>[]
  ).map((row) => ({
    id: Number(row.id),
    connectionId: Number(row.connection_id),
    username: String(row.username),
    sql: String(row.sql),
    ts: Number(row.ts),
    durationMs: Number(row.duration_ms),
    rowCount: Number(row.row_count),
    ok: Number(row.ok) === 1,
    error: String(row.error ?? ""),
  }));
}

/* --- Kayıtlı sorgular --- */

export type SavedQuery = {
  id: number;
  connectionId: number | null;
  name: string;
  sql: string;
  username: string;
};

export function listSavedQueries(): SavedQuery[] {
  return (
    getDb()
      .prepare(
        "SELECT id, connection_id, name, sql, username FROM db_saved_queries ORDER BY name COLLATE NOCASE",
      )
      .all() as Record<string, string | number | null>[]
  ).map((row) => ({
    id: Number(row.id),
    connectionId: row.connection_id === null ? null : Number(row.connection_id),
    name: String(row.name),
    sql: String(row.sql),
    username: String(row.username ?? ""),
  }));
}

export function saveQuery(input: {
  connectionId: number | null;
  name: string;
  sql: string;
  username: string;
}): number {
  const info = getDb()
    .prepare(
      "INSERT INTO db_saved_queries (connection_id, name, sql, username) VALUES (?, ?, ?, ?)",
    )
    .run(input.connectionId, input.name.trim(), input.sql, input.username);
  return Number(info.lastInsertRowid);
}

export function deleteSavedQuery(id: number): boolean {
  return Number(getDb().prepare("DELETE FROM db_saved_queries WHERE id = ?").run(id).changes) > 0;
}
