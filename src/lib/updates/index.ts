import { readCache, writeCache, type Cached } from "@/lib/db/cache";
import { checkImageUpdates, type ImageUpdate } from "@/lib/updates/images";
import { normalizeUpdate } from "./normalize";

export const IMAGE_UPDATE_CACHE_KEY = "updates.images";

/** Son kontrol sonucu — yoksa null (ekran "henüz kontrol edilmedi" der). */
export function cachedImageUpdates(): Cached<ImageUpdate[]> {
  const cached = readCache<ImageUpdate[]>(IMAGE_UPDATE_CACHE_KEY);
  if (!cached) return cached;
  // ⚠️ Önbellek DİSKTE ve panelin ESKİ sürümü tarafından yazılmış olabilir;
  // sonradan eklenen alanlar orada yok. Ayrıntı ve yaşanmış çökme:
  // `normalize.ts` başlığı.
  return { ...cached, value: cached.value.map(normalizeUpdate) };
}

/** Kontrolü çalıştırır ve sonucu saklar; hem job hem "şimdi kontrol et" kullanır. */
export async function refreshImageUpdates(): Promise<ImageUpdate[]> {
  const results = await checkImageUpdates();
  writeCache(IMAGE_UPDATE_CACHE_KEY, results);
  return results;
}

export type { ImageUpdate };
