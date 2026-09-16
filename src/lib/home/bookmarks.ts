import "server-only";
import { serverT } from "@/lib/i18n/runtime";

import { getDb } from "@/lib/db/client";
import { normalizeUrl } from "@/lib/apps/store";

/**
 * M2.7 — bookmark'lar.
 *
 * Kartlardan farkı: durumu izlenmez, logosu yüklenmez, widget'ı olmaz. Bir
 * bookmark yalnızca bir bağlantıdır ve ana sayfada gruplar halinde durur.
 */

export type Bookmark = {
  id: number;
  group: string;
  title: string;
  url: string;
  sortOrder: number;
};

export type BookmarkGroup = { name: string; items: Bookmark[] };

type Row = {
  id: number;
  group_name: string;
  title: string;
  url: string;
  sort_order: number;
};

function toBookmark(row: Row): Bookmark {
  return {
    id: row.id,
    group: row.group_name,
    title: row.title,
    url: row.url,
    sortOrder: row.sort_order,
  };
}

export function listBookmarks(): Bookmark[] {
  return (
    getDb()
      .prepare("SELECT * FROM bookmarks ORDER BY group_name, sort_order, title")
      .all() as Row[]
  ).map(toBookmark);
}

/**
 * Gruplu görünüm. Grup adı serbest metin olduğu için sıralama ada göre;
 * grupsuzlar en SONA alınıyor — adlandırılmış gruplar daha bilinçli bir
 * tercih ve önce görünmeli.
 */
export function bookmarkGroups(): BookmarkGroup[] {
  const groups = new Map<string, Bookmark[]>();
  for (const bookmark of listBookmarks()) {
    const key = bookmark.group.trim();
    groups.set(key, [...(groups.get(key) ?? []), bookmark]);
  }

  return [...groups.entries()]
    .map(([name, items]) => ({ name, items }))
    .sort((a, b) => {
      if (a.name === "") return 1;
      if (b.name === "") return -1;
      return a.name.localeCompare(b.name, "tr");
    });
}

export type BookmarkInput = { group: string; title: string; url: string };

export function validateBookmark(input: BookmarkInput): string | null {
  if (!input.title.trim()) return serverT("bookmarksLib.titleEmpty");
  if (!input.url.trim()) return serverT("appsStore.urlEmpty");
  try {
    new URL(normalizeUrl(input.url));
  } catch {
    return serverT("bookmarks.invalidUrl");
  }
  return null;
}

export function createBookmark(input: BookmarkInput): number {
  const row = getDb()
    .prepare(
      "SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM bookmarks WHERE group_name = ?",
    )
    .get(input.group.trim()) as { max_order: number };

  const result = getDb()
    .prepare(
      "INSERT INTO bookmarks (group_name, title, url, sort_order) VALUES (?, ?, ?, ?)",
    )
    .run(input.group.trim(), input.title.trim(), normalizeUrl(input.url), row.max_order + 10);

  return Number(result.lastInsertRowid);
}

export function updateBookmark(id: number, input: BookmarkInput): void {
  getDb()
    .prepare("UPDATE bookmarks SET group_name = ?, title = ?, url = ? WHERE id = ?")
    .run(input.group.trim(), input.title.trim(), normalizeUrl(input.url), id);
}

export function deleteBookmark(id: number): void {
  getDb().prepare("DELETE FROM bookmarks WHERE id = ?").run(id);
}

export function getBookmark(id: number): Bookmark | null {
  const row = getDb().prepare("SELECT * FROM bookmarks WHERE id = ?").get(id) as
    | Row
    | undefined;
  return row ? toBookmark(row) : null;
}

// --- Gövde ayrıştırma ------------------------------------------------------

/**
 * Gövdeden bookmark girdisi üretir.
 *
 * Route dosyasından buraya taşındı (T12/Faz D) — iç uç ve
 * `/api/v1/bookmarks` aynı doğrulamayı paylaşmalı.
 */
export function parseBookmark(
  body: Record<string, unknown>,
): { ok: true; input: BookmarkInput } | { ok: false; error: string } {
  const input: BookmarkInput = {
    group: String(body.group ?? ""),
    title: String(body.title ?? ""),
    url: String(body.url ?? ""),
  };
  const problem = validateBookmark(input);
  return problem ? { ok: false, error: problem } : { ok: true, input };
}
