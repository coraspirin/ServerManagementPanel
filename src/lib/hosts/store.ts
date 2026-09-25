import "server-only";

import { getDb } from "@/lib/db/client";
import { LOCAL_HOST_ID } from "./context";
import type { Host, HostAgentType, HostCapabilities, HostStatus } from "./types";

/**
 * `hosts` tablosu — okuma ve durum güncellemeleri.
 *
 * Sunucu listesi her istekte okunuyor (seçici, çözümleme); tablo birkaç
 * satırdan ibaret ve SQLite süreç içi, bu yüzden önbellek tutulmuyor —
 * önbellek, ajan durumunun ekranda gecikmesinden başka bir şey kazandırmazdı.
 */

type HostRow = {
  id: number;
  name: string;
  address: string | null;
  agent_type: string;
  is_local: number;
  enabled: number;
  status: string;
  agent_url: string | null;
  cert_fingerprint: string | null;
  last_seen: number | null;
  latency_ms: number | null;
  last_error: string | null;
  agent_version: string | null;
  protocol: number | null;
  capabilities: string;
  hostname: string | null;
  os_name: string | null;
  sort_order: number;
  color: string | null;
  created_at: number;
};

const COLUMNS = `id, name, address, agent_type, is_local, enabled, status, agent_url,
  cert_fingerprint, last_seen, latency_ms, last_error, agent_version, protocol,
  capabilities, hostname, os_name, sort_order, color, created_at`;

function parseCapabilities(raw: string): HostCapabilities {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" ? (value as HostCapabilities) : {};
  } catch {
    return {};
  }
}

function toHost(row: HostRow): Host {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    agentType: row.agent_type as HostAgentType,
    isLocal: row.is_local === 1,
    enabled: row.enabled === 1,
    status: row.status as HostStatus,
    agentUrl: row.agent_url,
    certFingerprint: row.cert_fingerprint,
    lastSeen: row.last_seen,
    latencyMs: row.latency_ms,
    lastError: row.last_error,
    agentVersion: row.agent_version,
    protocol: row.protocol,
    capabilities: parseCapabilities(row.capabilities),
    hostname: row.hostname,
    osName: row.os_name,
    sortOrder: row.sort_order,
    color: row.color,
    createdAt: row.created_at,
  };
}

export function listHosts(): Host[] {
  const rows = getDb()
    .prepare(`SELECT ${COLUMNS} FROM hosts ORDER BY is_local DESC, sort_order, name`)
    .all() as HostRow[];
  return rows.map(toHost);
}

/**
 * Arka plan işlerinin dolaşacağı sunucular: etkin olanlar; uzak olanlardan
 * yalnızca çevrimiçi olanlar (çevrimdışı sunucu için her turda zaman aşımı
 * beklemek işi gereksiz uzatırdı — dönüşünü heartbeat fark eder).
 */
export function activeHosts(): Host[] {
  return listHosts().filter((host) => host.enabled && (host.isLocal || host.status === "online"));
}

export function getHost(id: number): Host | null {
  const row = getDb().prepare(`SELECT ${COLUMNS} FROM hosts WHERE id = ?`).get(id) as
    | HostRow
    | undefined;
  return row ? toHost(row) : null;
}

export function isLocalHost(id: number): boolean {
  return id === LOCAL_HOST_ID || getHost(id)?.isLocal === true;
}

/** Şifreli ajan sırrı; yalnızca ajan istemcisi okur. */
export function hostTokenEnc(id: number): string | null {
  const row = getDb().prepare("SELECT token_enc FROM hosts WHERE id = ?").get(id) as
    | { token_enc: string | null }
    | undefined;
  return row?.token_enc ?? null;
}

export type HostStatusUpdate = {
  status: HostStatus;
  /**
   * Ajandan GERÇEKTEN yanıt alındı mı. `last_seen` yalnızca o zaman ilerler —
   * durumdan türetilseydi başarısız bir yoklama "hâlâ çevrimiçi" yazarken
   * son görülmeyi de tazeler ve sunucu hiçbir zaman çevrimdışı sayılmazdı.
   */
  seen?: boolean;
  latencyMs?: number | null;
  lastError?: string | null;
  agentVersion?: string | null;
  protocol?: number | null;
  capabilities?: HostCapabilities;
  hostname?: string | null;
  osName?: string | null;
};

export function updateHostStatus(id: number, update: HostStatusUpdate): void {
  const seen = update.seen === true;
  getDb()
    .prepare(
      `UPDATE hosts SET
         status        = ?,
         last_seen     = CASE WHEN ? THEN unixepoch() ELSE last_seen END,
         latency_ms    = COALESCE(?, latency_ms),
         last_error    = ?,
         agent_version = COALESCE(?, agent_version),
         protocol      = COALESCE(?, protocol),
         capabilities  = COALESCE(?, capabilities),
         hostname      = COALESCE(?, hostname),
         os_name       = COALESCE(?, os_name)
       WHERE id = ?`,
    )
    .run(
      update.status,
      seen ? 1 : 0,
      update.latencyMs ?? null,
      update.lastError ?? null,
      update.agentVersion ?? null,
      update.protocol ?? null,
      update.capabilities ? JSON.stringify(update.capabilities) : null,
      update.hostname ?? null,
      update.osName ?? null,
      id,
    );
}

/**
 * 026'da FOREIGN KEY'siz eklenen `host_id` sütunları. 001–014'teki tablolar
 * `ON DELETE CASCADE` ile kendiliğinden temizleniyor.
 */
const HOST_SCOPED_TABLES = [
  "app_stacks",
  "backup_runs",
  "backup_jobs",
  "backup_repos",
  "db_connections",
  "job_runs",
  "apps",
  "log_cursors",
] as const;

/**
 * Sunucuyu ve ona ait tüm verileri siler. Yerel sunucu silinemez.
 */
export function removeHost(id: number): boolean {
  if (isLocalHost(id)) return false;
  const db = getDb();
  db.exec("BEGIN");
  try {
    for (const table of HOST_SCOPED_TABLES) {
      db.prepare(`DELETE FROM ${table} WHERE host_id = ?`).run(id);
    }
    db.prepare("DELETE FROM settings WHERE scope_type = 'host' AND scope_id = ?").run(String(id));
    // Sunucu başına önbellekler (imaj güncellemeleri, port taraması): `h<id>:` önekli.
    db.prepare("DELETE FROM cache WHERE key LIKE ?").run(`h${id}:%`);
    const result = db.prepare("DELETE FROM hosts WHERE id = ?").run(id);
    db.exec("COMMIT");
    return Number(result.changes) > 0;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function hostNameTaken(name: string, exceptId?: number): boolean {
  const row = getDb()
    .prepare("SELECT id FROM hosts WHERE name = ? COLLATE NOCASE AND id != ?")
    .get(name, exceptId ?? -1);
  return row !== undefined;
}

/** Kayıt bekleyen uzak sunucu satırı; sır şifreli yazılır. */
export function insertPendingHost(name: string, tokenEnc: string): number {
  const result = getDb()
    .prepare(
      `INSERT INTO hosts (name, agent_type, is_local, status, token_enc, sort_order)
       VALUES (?, 'agent', 0, 'pending', ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM hosts))`,
    )
    .run(name, tokenEnc);
  return Number(result.lastInsertRowid);
}

export function markEnrolled(
  id: number,
  input: { agentUrl: string; fingerprint: string; update: HostStatusUpdate },
): void {
  getDb()
    .prepare("UPDATE hosts SET agent_url = ?, address = ?, cert_fingerprint = ? WHERE id = ?")
    .run(input.agentUrl, new URL(input.agentUrl).hostname, input.fingerprint, id);
  updateHostStatus(id, input.update);
}

export function updateHostMeta(
  id: number,
  patch: { name?: string; enabled?: boolean; color?: string | null },
): void {
  const db = getDb();
  if (patch.name !== undefined) db.prepare("UPDATE hosts SET name = ? WHERE id = ?").run(patch.name, id);
  if (patch.enabled !== undefined) {
    db.prepare("UPDATE hosts SET enabled = ? WHERE id = ?").run(patch.enabled ? 1 : 0, id);
  }
  if (patch.color !== undefined) db.prepare("UPDATE hosts SET color = ? WHERE id = ?").run(patch.color, id);
}

/** Yeni sır (yeniden kayıt): eski sabitleme de düşer, ajan yeniden bağlanmalı. */
export function resetHostSecret(id: number, tokenEnc: string): void {
  getDb()
    .prepare(
      `UPDATE hosts SET token_enc = ?, cert_fingerprint = NULL, status = 'pending', last_error = NULL
       WHERE id = ? AND is_local = 0`,
    )
    .run(tokenEnc, id);
}
