import { getDb } from "@/lib/db/client";

/**
 * Runbook notları (M1.8).
 *
 * Not, container ADINA bağlanır (bkz. migration 007). Kapsam türü şimdilik
 * yalnızca "container"; Faz 2'de `apps` aynı tabloyu kullanacak.
 */

export type RunbookScope = "container" | "app" | "repo";

export type Runbook = {
  scopeType: RunbookScope;
  scopeId: string;
  body: string;
  updatedAt: number;
  updatedBy: string;
};

type Row = {
  scope_type: string;
  scope_id: string;
  body: string;
  updated_at: number;
  updated_by: string;
};

function toRunbook(row: Row): Runbook {
  return {
    scopeType: row.scope_type as RunbookScope,
    scopeId: row.scope_id,
    body: row.body,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export function getRunbook(scopeType: RunbookScope, scopeId: string): Runbook | null {
  const row = getDb()
    .prepare(
      `SELECT scope_type, scope_id, body, updated_at, updated_by
         FROM runbooks WHERE scope_type = ? AND scope_id = ?`,
    )
    .get(scopeType, scopeId) as Row | undefined;

  return row ? toRunbook(row) : null;
}

/** Hangi kapsamların notu olduğu — listede rozet göstermek için tek sorgu. */
export function runbookIds(scopeType: RunbookScope): Set<string> {
  const rows = getDb()
    .prepare("SELECT scope_id FROM runbooks WHERE scope_type = ?")
    .all(scopeType) as { scope_id: string }[];

  return new Set(rows.map((row) => row.scope_id));
}

/**
 * Notu yazar; boş gövde notu SİLER.
 *
 * Ayrı bir "sil" düğmesi koymak yerine böyle: kullanıcı metni temizleyip
 * kaydettiğinde beklediği şey notun gitmesidir, boş bir kaydın kalması değil.
 */
export function saveRunbook(
  scopeType: RunbookScope,
  scopeId: string,
  body: string,
  updatedBy: string,
): Runbook | null {
  const trimmed = body.trim();
  const db = getDb();

  if (trimmed === "") {
    db.prepare("DELETE FROM runbooks WHERE scope_type = ? AND scope_id = ?").run(
      scopeType,
      scopeId,
    );
    return null;
  }

  db.prepare(
    `INSERT INTO runbooks (scope_type, scope_id, body, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(host_id, scope_type, scope_id)
     DO UPDATE SET body = excluded.body,
                   updated_at = excluded.updated_at,
                   updated_by = excluded.updated_by`,
  ).run(scopeType, scopeId, trimmed, Math.floor(Date.now() / 1000), updatedBy);

  return getRunbook(scopeType, scopeId);
}

/**
 * Bildirime eklenecek özet.
 *
 * Notun tamamı gitmez: Telegram/ntfy mesajı uzadıkça okunmaz hale gelir ve
 * bazı kanallar kırpar. İlk birkaç satır "şimdi ne yapmalıyım" sorusunu
 * cevaplamaya yeter; gerisi panelde.
 */
export function runbookExcerpt(scopeId: string, maxChars = 400): string | null {
  const runbook = getRunbook("container", scopeId);
  if (!runbook) return null;

  const text = runbook.body.replace(/\r\n/g, "\n").trim();
  if (text.length <= maxChars) return text;

  const cut = text.slice(0, maxChars);
  const lastBreak = cut.lastIndexOf("\n");
  return `${(lastBreak > maxChars / 2 ? cut.slice(0, lastBreak) : cut).trimEnd()}…`;
}
