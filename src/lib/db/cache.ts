import { getDb } from "@/lib/db/client";

/**
 * Pahalı sonuçların kalıcı önbelleği (M1.10).
 *
 * Okuyan taraf her zaman "ne zaman yazıldı"yı da alır: panelde gösterilen
 * her önbellekli değerin yanında yaşı yazmalı. Tazeliği gizlenen bir veri,
 * yanlış veriden daha tehlikelidir — kullanıcı ona güvenip karar verir.
 */

export type Cached<T> = { value: T; updatedAt: number } | null;

export function readCache<T>(key: string): Cached<T> {
  const row = getDb()
    .prepare("SELECT value, updated_at FROM cache WHERE key = ?")
    .get(key) as { value: string; updated_at: number } | undefined;

  if (!row) return null;

  try {
    return { value: JSON.parse(row.value) as T, updatedAt: row.updated_at };
  } catch {
    // Bozuk kayıt yok sayılır; bir sonraki yazma düzeltir.
    return null;
  }
}

/**
 * Kaydı siler — "boş değer yazmak" ile karıştırılmamalı.
 *
 * Bir aksiyon veriyi geçersizleştirdiğinde (M2.6) satırın kalkması gerekiyor;
 * yerine `null` yazmak okuma tarafında "veri var ama boş" gibi görünürdü.
 */
export function deleteCache(key: string): void {
  getDb().prepare("DELETE FROM cache WHERE key = ?").run(key);
}

export function writeCache(key: string, value: unknown): void {
  getDb()
    .prepare(
      `INSERT INTO cache (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, JSON.stringify(value), Math.floor(Date.now() / 1000));
}
