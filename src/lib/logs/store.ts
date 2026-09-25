import "server-only";
import { serverT } from "@/lib/i18n/runtime";

import { getDb } from "@/lib/db/client";
import { currentHostId } from "@/lib/hosts/context";
import type {
  LogKind,
  LogLevel,
  LogPattern,
  LogRecord,
  LogSearch,
  LogSearchResult,
  LogSourceInfo,
} from "./types";

/** M3.3 — log satırlarının yazımı, aranması ve budanması. */

const MAX_LIMIT = 500;
const MAX_MESSAGE_LENGTH = 8000;

/**
 * Seviye mesajdan tahmin ediliyor. Container logları standart bir seviye alanı
 * taşımıyor — her uygulama kendi biçimini yazıyor. Bu yüzden tahmin KESİN
 * değil ve arayüzde bir filtre olarak sunuluyor, bir gerçek olarak değil.
 *
 * Sıra önemli: "error" içeren bir satır aynı zamanda "warn" içerebilir; daha
 * ciddi olan kazanmalı.
 */
export function guessLevel(message: string, stream: string): LogLevel {
  const text = message.toLowerCase();
  if (/\b(error|err|fatal|panic|critical|crit|exception|failed|failure)\b/.test(text)) {
    return "error";
  }
  if (/\b(warn|warning|deprecated)\b/.test(text)) return "warning";
  if (/\b(debug|trace|verbose)\b/.test(text)) return "debug";
  // stderr tek başına hata demek değil (birçok uygulama oraya normal log yazar),
  // ama hiçbir ipucu yoksa uyarı saymak makul.
  return stream === "stderr" ? "warning" : "info";
}

export type IncomingLine = {
  ts: number;
  source: string;
  kind: LogKind;
  stream: string;
  message: string;
  /** Kaynak kendi seviyesini biliyorsa (journald) tahmin atlanır. */
  level?: LogLevel;
};

/**
 * Toplu ekleme. Tek transaction: bir tur binlerce satır getirebilir ve her
 * satır için ayrı commit, SQLite'ta işi yüz kat yavaşlatır.
 */
export function insertLines(lines: IncomingLine[]): number {
  if (lines.length === 0) return 0;

  const db = getDb();
  const insert = db.prepare(
    "INSERT INTO log_lines (host_id, ts, source, kind, stream, level, message) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  // Çoklu sunucu: satırlar toplandıkları sunucunun bağlamına yazılır.
  const hostId = currentHostId();

  db.exec("BEGIN");
  try {
    for (const line of lines) {
      insert.run(
        hostId,
        line.ts,
        line.source,
        line.kind,
        line.stream,
        line.level ?? guessLevel(line.message, line.stream),
        line.message.slice(0, MAX_MESSAGE_LENGTH),
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return lines.length;
}

/**
 * Kullanıcının yazdığı metni FTS5'in anlayacağı sorguya çevirir.
 *
 * Ham metni doğrudan MATCH'e vermek iki sorun çıkarır: kullanıcının yazdığı
 * tire, tırnak ya da parantez sözdizimi hatası verir (arama çöker), ve `NOT`
 * gibi sözcükler istemeden operatör olarak yorumlanır. Bu yüzden her sözcük
 * tırnak içine alınıp AND ile birleştiriliyor; sonuna * yazan kullanıcı ön ek
 * araması yapabilsin diye o tek istisna korunuyor.
 */
export function toMatchQuery(raw: string): string | null {
  const words = raw
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) => {
      const prefix = word.endsWith("*");
      const core = (prefix ? word.slice(0, -1) : word).replaceAll('"', "");
      if (core.length === 0) return null;
      return prefix ? `"${core}"*` : `"${core}"`;
    })
    .filter((word): word is string => word !== null);

  return words.length > 0 ? words.join(" AND ") : null;
}

type Where = { sql: string; params: (string | number)[] };

function buildWhere(search: LogSearch, matchQuery: string | null): Where {
  // Arama her zaman seçili sunucunun satırlarında.
  const clauses: string[] = ["l.host_id = ?"];
  const params: (string | number)[] = [currentHostId()];

  if (matchQuery) {
    clauses.push("l.id IN (SELECT rowid FROM log_fts WHERE log_fts MATCH ?)");
    params.push(matchQuery);
  }
  if (search.sources && search.sources.length > 0) {
    clauses.push(`l.source IN (${search.sources.map(() => "?").join(",")})`);
    params.push(...search.sources);
  }
  if (search.levels && search.levels.length > 0) {
    clauses.push(`l.level IN (${search.levels.map(() => "?").join(",")})`);
    params.push(...search.levels);
  }
  if (search.kind) {
    clauses.push("l.kind = ?");
    params.push(search.kind);
  }
  if (search.since !== undefined) {
    clauses.push("l.ts >= ?");
    params.push(search.since);
  }
  if (search.until !== undefined) {
    clauses.push("l.ts <= ?");
    params.push(search.until);
  }

  return { sql: `WHERE ${clauses.join(" AND ")}`, params };
}

export function searchLogs(search: LogSearch = {}): LogSearchResult {
  const db = getDb();
  const matchQuery = search.q ? toMatchQuery(search.q) : null;
  const where = buildWhere(search, matchQuery);
  const limit = Math.min(Math.max(search.limit ?? 200, 1), MAX_LIMIT);
  const offset = Math.max(search.offset ?? 0, 0);

  const records = (
    db
      .prepare(
        `SELECT l.id, l.ts, l.source, l.kind, l.stream, l.level, l.message
         FROM log_lines l ${where.sql}
         ORDER BY l.ts DESC, l.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...where.params, limit, offset) as Record<string, string | number>[]
  ).map(toRecord);

  const total = Number(
    (
      db.prepare(`SELECT COUNT(*) AS n FROM log_lines l ${where.sql}`).get(...where.params) as {
        n: number;
      }
    ).n,
  );

  const summary = db
    .prepare("SELECT COUNT(*) AS n, MIN(ts) AS oldest FROM log_lines WHERE host_id = ?")
    .get(currentHostId()) as { n: number; oldest: number | null };

  return {
    records,
    total,
    sources: listSources(),
    totalLines: Number(summary.n),
    oldest: summary.oldest === null ? null : Number(summary.oldest),
  };
}

function toRecord(row: Record<string, string | number>): LogRecord {
  return {
    id: Number(row.id),
    ts: Number(row.ts),
    source: String(row.source),
    kind: String(row.kind) as LogKind,
    stream: String(row.stream),
    level: String(row.level) as LogLevel,
    message: String(row.message),
  };
}

/**
 * Kaynak listesi hem toplanmış satırlardan hem imleç tablosundan geliyor:
 * bir kaynak henüz hiç satır üretmemiş olabilir ama toplayıcının onu denediği
 * ve neden başarısız olduğu görünmeli.
 */
export function listSources(): LogSourceInfo[] {
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT c.source, c.kind, c.last_run_at, c.last_count, c.last_error,
              COALESCE(s.lines, 0)  AS lines,
              COALESCE(s.oldest, 0) AS oldest,
              COALESCE(s.newest, 0) AS newest
       FROM log_cursors c
       LEFT JOIN (
         SELECT source, COUNT(*) AS lines, MIN(ts) AS oldest, MAX(ts) AS newest
         FROM log_lines WHERE host_id = ? GROUP BY source
       ) s ON s.source = c.source
       WHERE c.host_id = ?
       ORDER BY c.source`,
    )
    .all(currentHostId(), currentHostId()) as Record<string, string | number | null>[];

  return rows.map((row) => ({
    source: String(row.source),
    kind: String(row.kind) as LogKind,
    lines: Number(row.lines),
    oldest: Number(row.oldest),
    newest: Number(row.newest),
    lastRunAt: row.last_run_at === null ? null : Number(row.last_run_at),
    lastCount: Number(row.last_count),
    lastError: String(row.last_error ?? ""),
  }));
}

export function readCursor(source: string): number {
  const row = getDb()
    .prepare("SELECT last_ts FROM log_cursors WHERE host_id = ? AND source = ?")
    .get(currentHostId(), source) as
    | { last_ts: number }
    | undefined;
  return row ? Number(row.last_ts) : 0;
}

export function writeCursor(
  source: string,
  kind: LogKind,
  lastTs: number,
  count: number,
  error = "",
): void {
  getDb()
    .prepare(
      `INSERT INTO log_cursors (host_id, source, kind, last_ts, last_run_at, last_count, last_error)
       VALUES (?, ?, ?, ?, unixepoch(), ?, ?)
       ON CONFLICT(host_id, source) DO UPDATE SET
         kind = excluded.kind,
         -- İmleç geri gitmemeli: bir turda hiç satır gelmediyse eski değer kalır,
         -- yoksa aynı satırlar tekrar tekrar toplanırdı.
         last_ts = MAX(log_cursors.last_ts, excluded.last_ts),
         last_run_at = excluded.last_run_at,
         last_count = excluded.last_count,
         last_error = excluded.last_error`,
    )
    .run(currentHostId(), source, kind, lastTs, count, error);
}

/** Artık var olmayan kaynakların imleci temizlenir (container silinmiş vb.). */
export function forgetSource(source: string): void {
  getDb().prepare("DELETE FROM log_cursors WHERE host_id = ? AND source = ?").run(currentHostId(), source);
}

export type PruneOutcome = { removed: number; bySize: number };

/**
 * Budama iki eşikten geçiyor: yaş ve toplam satır sayısı.
 *
 * Yalnızca yaşa bakmak yetmez — konuşkan tek bir container, saklama süresi
 * dolmadan veritabanını gigabaytlara çıkarabilir. Satır tavanı bu durumda
 * en eskiden keserek üst sınırı garanti eder.
 */
export function pruneLogs(retentionDays: number, maxLines: number): PruneOutcome {
  const db = getDb();
  let removed = 0;

  if (retentionDays > 0) {
    removed = Number(
      db
        .prepare("DELETE FROM log_lines WHERE ts < unixepoch() - ?")
        .run(retentionDays * 86400).changes,
    );
  }

  let bySize = 0;
  if (maxLines > 0) {
    const total = Number(
      (db.prepare("SELECT COUNT(*) AS n FROM log_lines").get() as { n: number }).n,
    );
    if (total > maxLines) {
      bySize = Number(
        db
          .prepare(
            `DELETE FROM log_lines WHERE id IN (
               SELECT id FROM log_lines ORDER BY ts ASC, id ASC LIMIT ?
             )`,
          )
          .run(total - maxLines).changes,
      );
    }
  }

  // External content FTS5'te silme, indekste "tombstone" bırakır. Optimize
  // olmadan indeks dosyası küçülmez ve arama zamanla yavaşlar.
  if (removed + bySize > 0) {
    db.exec("INSERT INTO log_fts(log_fts) VALUES ('optimize')");
  }

  return { removed, bySize };
}

/* --- Desen kuralları --- */

export function listPatterns(): LogPattern[] {
  return (
    getDb()
      .prepare(
        `SELECT id, name, pattern, is_regex, source_filter, severity, enabled,
                cooldown_minutes, last_hit_at, hit_count
         FROM log_patterns ORDER BY name COLLATE NOCASE`,
      )
      .all() as Record<string, string | number | null>[]
  ).map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    pattern: String(row.pattern),
    isRegex: Number(row.is_regex) === 1,
    sourceFilter: String(row.source_filter),
    severity: String(row.severity) as LogPattern["severity"],
    enabled: Number(row.enabled) === 1,
    cooldownMinutes: Number(row.cooldown_minutes),
    lastHitAt: row.last_hit_at === null ? null : Number(row.last_hit_at),
    hitCount: Number(row.hit_count),
  }));
}

export type PatternInput = {
  name: string;
  pattern: string;
  isRegex: boolean;
  sourceFilter: string;
  severity: LogPattern["severity"];
  enabled: boolean;
  cooldownMinutes: number;
};

export function validatePattern(input: PatternInput): string | null {
  if (input.name.trim().length < 2) return serverT("logStore.ruleName");
  if (input.pattern.trim().length === 0) return serverT("logStore.patternEmpty");
  if (input.isRegex) {
    try {
      new RegExp(input.pattern, "i");
    } catch (error) {
      return serverT("logStore.invalidRegex", {
        error: error instanceof Error ? error.message : serverT("console.unknownError"),
      });
    }
  }
  if (input.cooldownMinutes < 0 || input.cooldownMinutes > 1440) {
    return serverT("logStore.cooldownRange");
  }
  return null;
}

export function createPattern(input: PatternInput): number {
  const info = getDb()
    .prepare(
      `INSERT INTO log_patterns
         (name, pattern, is_regex, source_filter, severity, enabled, cooldown_minutes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.name.trim(),
      input.pattern,
      input.isRegex ? 1 : 0,
      input.sourceFilter.trim(),
      input.severity,
      input.enabled ? 1 : 0,
      input.cooldownMinutes,
    );
  return Number(info.lastInsertRowid);
}

export function updatePattern(id: number, input: PatternInput): boolean {
  return (
    Number(
      getDb()
        .prepare(
          `UPDATE log_patterns
           SET name = ?, pattern = ?, is_regex = ?, source_filter = ?,
               severity = ?, enabled = ?, cooldown_minutes = ?
           WHERE id = ?`,
        )
        .run(
          input.name.trim(),
          input.pattern,
          input.isRegex ? 1 : 0,
          input.sourceFilter.trim(),
          input.severity,
          input.enabled ? 1 : 0,
          input.cooldownMinutes,
          id,
        ).changes,
    ) > 0
  );
}

export function deletePattern(id: number): boolean {
  return Number(getDb().prepare("DELETE FROM log_patterns WHERE id = ?").run(id).changes) > 0;
}

export function markPatternHit(id: number, ts: number): void {
  getDb()
    .prepare("UPDATE log_patterns SET last_hit_at = ?, hit_count = hit_count + 1 WHERE id = ?")
    .run(ts, id);
}
