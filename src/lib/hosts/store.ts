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
  latencyMs?: number | null;
  lastError?: string | null;
  agentVersion?: string | null;
  protocol?: number | null;
  capabilities?: HostCapabilities;
  hostname?: string | null;
  osName?: string | null;
};

export function updateHostStatus(id: number, update: HostStatusUpdate): void {
  const seen = update.status === "online" || update.status === "incompatible";
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
    const result = db.prepare("DELETE FROM hosts WHERE id = ?").run(id);
    db.exec("COMMIT");
    return Number(result.changes) > 0;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
