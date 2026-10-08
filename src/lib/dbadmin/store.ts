import "server-only";
import { serverT } from "@/lib/i18n/runtime";

import { getDb } from "@/lib/db/client";
import { currentHostId } from "@/lib/hosts/context";
import { decryptSecret, encryptSecret, type EncryptedValue } from "@/lib/crypto";
import { DEFAULT_PORT, type DbConnection, type DbEngine, type DbTransport, type NativeMeta } from "./types";

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
                writable, source, container, transport, instance_key, meta_json,
                last_ok_at, last_error
         FROM db_connections WHERE host_id = ? ORDER BY name COLLATE NOCASE`,
      )
      // Bağlantılar sunucuya bağlı: veritabanına o sunucunun ajanı bağlanır.
      .all(currentHostId()) as Record<string, string | number | null>[]
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
      source: sourceOf(String(row.source)),
      container: String(row.container),
      transport: transportOf(String(row.transport)),
      instanceKey: String(row.instance_key ?? ""),
      meta: parseMeta(String(row.meta_json ?? "{}")),
      lastOkAt: row.last_ok_at === null ? null : Number(row.last_ok_at),
      lastError: String(row.last_error ?? ""),
    };
  });
}

function sourceOf(raw: string): DbConnection["source"] {
  return raw === "docker" || raw === "auto" ? raw : "manual";
}

function transportOf(raw: string): DbTransport {
  return raw === "docker" || raw === "native" ? raw : "tcp";
}

function parseMeta(raw: string): NativeMeta {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" ? (value as NativeMeta) : {};
  } catch {
    return {};
  }
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

export function validateConnection(input: ConnectionInput, id = 0): string | null {
  if (input.name.trim().length < 2) return serverT("dbStore.name");
  // Ad tablo genelinde UNIQUE (bkz. 034) — çakışma SQLite hatası olarak
  // 500'e dönmesin, açıklamalı reddedilsin.
  const taken = getDb()
    .prepare("SELECT 1 FROM db_connections WHERE name = ? AND id <> ?")
    .get(input.name.trim(), id);
  if (taken) return serverT("dbStore.nameTaken");
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
         (host_id, name, engine, host, port, username, password_enc, database, writable, source, container)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      currentHostId(),
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
       WHERE id = ? AND host_id = ?`,
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
      currentHostId(),
    ).changes;
  if (Number(changes) === 0) return false;

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
  return (
    Number(
      getDb()
        .prepare("DELETE FROM db_connections WHERE id = ? AND host_id = ?")
        .run(id, currentHostId()).changes,
    ) > 0
  );
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
        `SELECT h.id, h.connection_id, h.username, h.sql, h.ts, h.duration_ms, h.row_count, h.ok, h.error
         FROM db_query_history h JOIN db_connections c ON c.id = h.connection_id
         WHERE h.user_id = ? AND c.host_id = ? ORDER BY h.ts DESC, h.id DESC LIMIT ?`,
      )
      .all(userId, currentHostId(), limit) as Record<string, string | number>[]
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
        `SELECT id, connection_id, name, sql, username FROM db_saved_queries
         WHERE connection_id IS NULL
            OR connection_id IN (SELECT id FROM db_connections WHERE host_id = ?)
         ORDER BY name COLLATE NOCASE`,
      )
      .all(currentHostId()) as Record<string, string | number | null>[]
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

/* --- Envanter --- */

export type InstanceRecord = {
  key: string;
  engine: DbEngine;
  /** SQLite dosyaları "tcp": envanterden gelse de sürücüyle doğrudan açılıyor. */
  transport: DbTransport;
  container: string;
  host: string;
  port: number;
  meta: NativeMeta;
};

/**
 * Envanterin bulduğu sunucuyu bağlantı satırına eşler; satırın kimliği sabit
 * kalır ki sorgu geçmişi ve kayıtlı sorgular ona bağlı kalsın.
 *
 * Yeni satır YAZILAMAZ başlar (keşifle aynı ilke). İç ad benzersiz; arayüz
 * adı container/servis adından üretir (bkz. 034).
 */
export function upsertInstance(record: InstanceRecord): number {
  const db = getDb();
  const hostId = currentHostId();
  const existing = db
    .prepare("SELECT id FROM db_connections WHERE host_id = ? AND instance_key = ?")
    .get(hostId, record.key) as { id: number } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE db_connections
       SET engine = ?, transport = ?, container = ?, host = ?, port = ?, meta_json = ?
       WHERE id = ?`,
    ).run(
      record.engine,
      record.transport,
      record.container,
      record.host,
      record.port,
      JSON.stringify(record.meta),
      existing.id,
    );
    return Number(existing.id);
  }

  const info = db
    .prepare(
      `INSERT INTO db_connections
         (host_id, name, engine, host, port, writable, source, container, transport, instance_key, meta_json)
       VALUES (?, ?, ?, ?, ?, 0, 'auto', ?, ?, ?, ?)`,
    )
    .run(
      hostId,
      `@${hostId}:${record.key}`,
      record.engine,
      record.host,
      record.port,
      record.container,
      record.transport,
      record.key,
      JSON.stringify(record.meta),
    );
  return Number(info.lastInsertRowid);
}

/**
 * Artık bulunmayan envanter satırlarını siler. Yalnızca kendiliğinden
 * oluşanlar ve kullanıcının kimlik GİRMEDİKLERİ: girilmiş bir parolayı,
 * container geçici olarak silindi diye kaybetmek can sıkardı.
 *
 * `scanned`: bu turda başarıyla taranan anahtar önekleri ("docker:",
 * "sqlite:"…). Taraması başarısız olan türün satırlarına dokunulmaz.
 */
export function pruneInstances(presentKeys: string[], scanned: string[]): void {
  const present = new Set(presentKeys);
  const rows = getDb()
    .prepare(
      `SELECT id, instance_key FROM db_connections
       WHERE host_id = ? AND source = 'auto' AND password_enc = '' AND username = ''`,
    )
    .all(currentHostId()) as { id: number; instance_key: string }[];
  const remove = getDb().prepare("DELETE FROM db_connections WHERE id = ?");
  for (const row of rows) {
    const covered = scanned.some((prefix) => row.instance_key.startsWith(prefix));
    if (covered && !present.has(row.instance_key)) remove.run(row.id);
  }
}

/** Envanter sunucusunun kimliği: boş kullanıcı adı "kendiliğinden bul" demek. */
export function setInstanceCredentials(id: number, username: string, password: string): boolean {
  return (
    Number(
      getDb()
        .prepare(
          `UPDATE db_connections SET username = ?, password_enc = ?
           WHERE id = ? AND host_id = ? AND instance_key <> ''`,
        )
        .run(
          username.trim(),
          password ? JSON.stringify(encryptSecret(password)) : "",
          id,
          currentHostId(),
        ).changes,
    ) > 0
  );
}

export function setWritable(id: number, writable: boolean): boolean {
  return (
    Number(
      getDb()
        .prepare("UPDATE db_connections SET writable = ? WHERE id = ? AND host_id = ?")
        .run(writable ? 1 : 0, id, currentHostId()).changes,
    ) > 0
  );
}
