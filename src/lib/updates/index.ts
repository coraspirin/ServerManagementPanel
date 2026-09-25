import { readCache, writeCache, type Cached } from "@/lib/db/cache";
import { currentHostId, LOCAL_HOST_ID } from "@/lib/hosts/context";
import { checkImageUpdates, type ImageUpdate } from "@/lib/updates/images";
import { normalizeUpdate } from "./normalize";

export const IMAGE_UPDATE_CACHE_KEY = "updates.images";

/**
 * Sunucu başına önbellek anahtarı. Yerel sunucu eski anahtarı koruyor:
 * güncellemeden önce yazılmış sonuç kaybolmasın.
 */
function cacheKey(): string {
  const hostId = currentHostId();
  return hostId === LOCAL_HOST_ID ? IMAGE_UPDATE_CACHE_KEY : `h${hostId}:${IMAGE_UPDATE_CACHE_KEY}`;
}

/** Son kontrol sonucu — yoksa null (ekran "henüz kontrol edilmedi" der). */
export function cachedImageUpdates(): Cached<ImageUpdate[]> {
  const cached = readCache<ImageUpdate[]>(cacheKey());
  if (!cached) return cached;
  // ⚠️ Önbellek DİSKTE ve panelin ESKİ sürümü tarafından yazılmış olabilir;
  // sonradan eklenen alanlar orada yok. Ayrıntı ve yaşanmış çökme:
  // `normalize.ts` başlığı.
  return { ...cached, value: cached.value.map(normalizeUpdate) };
}

/** Kontrolü çalıştırır ve sonucu saklar; hem job hem "şimdi kontrol et" kullanır. */
export async function refreshImageUpdates(): Promise<ImageUpdate[]> {
  const results = await checkImageUpdates();
  writeCache(cacheKey(), results);
  return results;
}

export type { ImageUpdate };
