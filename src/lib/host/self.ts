import "server-only";

import { getDockerProvider } from "@/lib/providers";

/**
 * Panelin kendi container'ı hakkında bilgi.
 *
 * Yedekleme motoru (M3.4) ve dosya yöneticisi (M3.5), panelin veri dizinini
 * BAŞKA bir container'a bağlamak zorunda: biri onu yedeklemek, diğeri oradan
 * host'a dosya kopyalamak için. İkisi de volume'ün gerçek adını bilmek
 * durumunda.
 *
 * Ad sabit yazılmıyor: compose proje adı (yani dizin adı) değişince volume adı
 * da değişir ve sabit yazılmış bir ad sessizce yanlış yeri gösterirdi.
 */

export function panelContainerName(): string {
  return process.env.PANEL_CONTAINER_NAME ?? "server-panel-panel-1";
}

let cached: { name: string | null; at: number } | null = null;
let cachedImage: { name: string | null; at: number } | null = null;
const CACHE_MS = 60_000;

/**
 * Panelin kendi imajının adı.
 *
 * Yükseltilmiş okuma (M3.5) bu imajı kullanıyor: içinde zaten Node var, ayrıca
 * bir imaj indirmek gerekmiyor ve sürümü panelinkiyle her zaman aynı.
 */
export async function panelImage(): Promise<string | null> {
  if (cachedImage && Date.now() - cachedImage.at < CACHE_MS) return cachedImage.name;

  try {
    const raw = (await getDockerProvider().inspectRaw(panelContainerName())) as {
      Config?: { Image?: string };
    } | null;
    const name = raw?.Config?.Image ?? null;
    cachedImage = { name, at: Date.now() };
    return name;
  } catch {
    return null;
  }
}

/** `/app/data`'nın geldiği named volume; bulunamazsa null. */
export async function panelDataVolume(): Promise<string | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.name;

  try {
    const raw = (await getDockerProvider().inspectRaw(panelContainerName())) as {
      Mounts?: { Type?: string; Name?: string; Destination?: string }[];
    } | null;

    const mount = raw?.Mounts?.find((entry) => entry.Destination === "/app/data");
    const name = mount?.Type === "volume" && mount.Name ? mount.Name : null;
    cached = { name, at: Date.now() };
    return name;
  } catch {
    return null;
  }
}
