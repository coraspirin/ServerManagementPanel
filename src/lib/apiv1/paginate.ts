/**
 * T12 — imleç (cursor) sayfalama.
 *
 * `offset` DEĞİL, bilerek. `events` sürekli yeni satır alan bir tablo; offset
 * ile sayfa gezerken araya yeni kayıt girdiğinde sayfa kayar ve istemci aynı
 * satırı iki kez görür ya da hiç görmez. İmleç bu sınıf hatayı yapısal olarak
 * imkânsız kılıyor: konumu sıra numarası değil, son satırın kendisi tarif
 * ediyor.
 */

/** Sıralama `ts DESC, id DESC`; `id` olmadan aynı saniyedeki kayıtlarda sınır belirsiz kalır. */
export type Cursor = { ts: number; id: number };

/** İstemci için OPAK. `docs/API.md` içeriğini belgelemez, istemci yorumlamaz. */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.ts}:${cursor.id}`, "utf8").toString("base64url");
}

export function decodeCursor(raw: string): Cursor | null {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const match = /^(\d+):(\d+)$/.exec(decoded);
  if (!match) return null;

  const ts = Number(match[1]);
  const id = Number(match[2]);
  if (!Number.isSafeInteger(ts) || !Number.isSafeInteger(id)) return null;

  return { ts, id };
}

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
};

/**
 * Sorgudan bir fazla satır çekilip sayfa kurulur.
 *
 * `limit + 1` okumanın sebebi: "daha var mı" sorusunu ayrı bir COUNT sorgusu
 * olmadan cevaplamak. COUNT, filtrelenmiş bir tabloda sayfa başına ikinci bir
 * tam tarama demekti.
 */
export function buildPage<T>(
  rows: T[],
  limit: number,
  cursorOf: (row: T) => Cursor,
): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];

  return {
    items,
    nextCursor: hasMore && last !== undefined ? encodeCursor(cursorOf(last)) : null,
    hasMore,
  };
}

/**
 * Koleksiyon uçlarının üst sınırları.
 *
 * Sınırsız bir liste ucu, tek bir çağrıyla paneli düşürebilecek bir sorgudur.
 * İstemcinin gönderdiği değer tavanla SESSİZCE kırpılır (hata değil) —
 * `queryAudit`'in `Math.min(..., MAX_LIMIT)` kalıbının aynısı. Fazla veri
 * istemek bir hata değil, karşılanamayan bir istek; 400 döndürmek istemciyi
 * gereksiz yere kırardı.
 */
export const LIMITS = {
  events: { fallback: 100, max: 500 },
  logsTail: { fallback: 200, max: 2000 },
  collection: { fallback: 200, max: 500 },
} as const;

/**
 * Sorgu parametresinden sayı — tavana kırpılmış.
 *
 * `parse.ts` yerine BURADA: bu fonksiyonun tek işi yukarıdaki `LIMITS`
 * tavanlarını uygulamak, yani sayfalama konusunun parçası. `parse.ts` gövde
 * okumaya bakıyor ve `Response` üretmek için `respond.ts`e bağlı; saf bir
 * yardımcıyı oraya koymak, onu test etmek için bütün yanıt katmanını
 * yüklemek demekti.
 *
 * Tavanı aşan değer SESSİZCE kırpılır, hata verilmez — fazla veri istemek
 * bir hata değil, karşılanamayan bir istek.
 */
export function clampedNumber(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

/** Opsiyonel unix zaman damgası; geçersizse yok sayılır. */
export function optionalTimestamp(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}
