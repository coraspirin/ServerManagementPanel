import "server-only";

import { getDb } from "@/lib/db/client";
import { currentHostId } from "@/lib/hosts/context";

export type AuditEntry = {
  userId?: number | null;
  username?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  detail?: string;
  ip?: string;
  result?: "ok" | "denied" | "error";
};

/**
 * Her yetkili işlem buraya yazılır (Güvenlik Notu). Audit yazımı asla ana
 * işlemi düşürmemeli: hata olursa loglanır, istisna yukarı taşınmaz.
 */
export function audit(entry: AuditEntry): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO audit_log
           (host_id, user_id, username, action, target_type, target_id, detail, ip, result)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        // Çoklu sunucu: işlem hangi sunucu seçiliyken yapıldıysa o.
        currentHostId(),
        entry.userId ?? null,
        entry.username ?? "",
        entry.action,
        entry.targetType ?? "",
        entry.targetId ?? "",
        entry.detail ?? "",
        entry.ip ?? "",
        entry.result ?? "ok",
      );
  } catch (error) {
    console.error("[audit] kayıt yazılamadı:", error);
  }
}

/* --- M3.1 — audit görüntüleyici --- */

export type AuditRecord = {
  id: number;
  ts: number;
  userId: number | null;
  username: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: string;
  ip: string;
  result: string;
};

export type AuditFilter = {
  q?: string;
  username?: string;
  action?: string;
  result?: string;
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
};

export type AuditPage = {
  records: AuditRecord[];
  total: number;
  /** Filtre kutularını doldurmak için: kayıtlarda GERÇEKTEN geçen değerler. */
  actions: string[];
  usernames: string[];
};

const MAX_LIMIT = 500;

/**
 * Filtreler SQL'e parametreli olarak giriyor; `q` serbest metin ve birden çok
 * sütunda aranıyor. FTS kullanılmadı: audit tablosu bu ölçekte (yılda birkaç
 * yüz bin satır) LIKE ile rahat taranıyor ve ikinci bir indeks maliyeti
 * getirmiyor. Merkezi log arama (M3.3) FTS5 kullanacak — orada hacim başka.
 */
function buildWhere(filter: AuditFilter): { sql: string; params: (string | number)[] } {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (filter.username) {
    clauses.push("username = ?");
    params.push(filter.username);
  }
  if (filter.action) {
    clauses.push("action = ?");
    params.push(filter.action);
  }
  if (filter.result) {
    clauses.push("result = ?");
    params.push(filter.result);
  }
  if (filter.since !== undefined) {
    clauses.push("ts >= ?");
    params.push(filter.since);
  }
  if (filter.until !== undefined) {
    clauses.push("ts <= ?");
    params.push(filter.until);
  }
  if (filter.q) {
    clauses.push("(action LIKE ? OR detail LIKE ? OR target_id LIKE ? OR username LIKE ? OR ip LIKE ?)");
    const like = `%${filter.q}%`;
    params.push(like, like, like, like, like);
  }

  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

export function queryAudit(filter: AuditFilter = {}): AuditPage {
  const db = getDb();
  const { sql, params } = buildWhere(filter);
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), MAX_LIMIT);
  const offset = Math.max(filter.offset ?? 0, 0);

  const records = (
    db
      .prepare(
        `SELECT id, ts, user_id, username, action, target_type, target_id, detail, ip, result
         FROM audit_log ${sql} ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as Record<string, string | number | null>[]
  ).map((row) => ({
    id: Number(row.id),
    ts: Number(row.ts),
    userId: row.user_id === null ? null : Number(row.user_id),
    username: String(row.username),
    action: String(row.action),
    targetType: String(row.target_type),
    targetId: String(row.target_id),
    detail: String(row.detail),
    ip: String(row.ip),
    result: String(row.result),
  }));

  const total = Number(
    (db.prepare(`SELECT COUNT(*) AS n FROM audit_log ${sql}`).get(...params) as { n: number }).n,
  );

  const actions = (
    db.prepare("SELECT DISTINCT action FROM audit_log ORDER BY action").all() as {
      action: string;
    }[]
  ).map((row) => row.action);

  const usernames = (
    db
      .prepare("SELECT DISTINCT username FROM audit_log WHERE username <> '' ORDER BY username")
      .all() as { username: string }[]
  ).map((row) => row.username);

  return { records, total, actions, usernames };
}

/** Saklama süresi dolan kayıtları budar (0 = sınırsız, hiç silme). */
export function pruneAudit(retentionDays: number): number {
  if (retentionDays <= 0) return 0;
  return Number(
    getDb()
      .prepare("DELETE FROM audit_log WHERE ts < unixepoch() - ?")
      .run(retentionDays * 86400).changes,
  );
}
