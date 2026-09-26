import "server-only";

import { hostname } from "node:os";
import { currentHostId } from "@/lib/hosts/context";
import { getHost, isLocalHost } from "@/lib/hosts/store";
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
  const hostId = currentHostId();
  if (!isLocalHost(hostId)) return remotePanelImage(hostId);
  if (cachedImage && Date.now() - cachedImage.at < CACHE_MS) return cachedImage.name;

  const name = await ownImage();
  cachedImage = { name, at: Date.now() };
  return name;
}

/**
 * Bu makinede panelin (ya da ajanın) çalıştığı imaj. Önce bilinen container
 * adı; bulunamazsa container'ın kendi hostname'i — Docker varsayılan olarak
 * kısa container kimliğini verir ve ajanın container adı kuruluma göre değişir.
 */
export async function ownImage(): Promise<string | null> {
  for (const candidate of [panelContainerName(), hostname()]) {
    try {
      const raw = (await getDockerProvider().inspectRaw(candidate)) as {
        Config?: { Image?: string };
      } | null;
      if (raw?.Config?.Image) return raw.Config.Image;
    } catch {
      // Sıradaki aday.
    }
  }
  return null;
}

const remoteImages = new Map<number, { name: string | null; at: number }>();

/**
 * Uzak sunucuda yükseltilmiş işlerin (dosya okuma, compose yazma) imajı:
 * oradaki ajanın kendi imajı — içinde Node var ve o sunucuda zaten mevcut.
 */
async function remotePanelImage(hostId: number): Promise<string | null> {
  const cached = remoteImages.get(hostId);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.name;

  const host = getHost(hostId);
  if (!host || host.agentType !== "agent") return null;
  const { agentCall } = await import("@/lib/agent/client");
  try {
    const name = await agentCall<string | null>(host, "agent.image");
    remoteImages.set(hostId, { name, at: Date.now() });
    return name;
  } catch {
    return null;
  }
}

/** `/app/data`'nın geldiği named volume; bulunamazsa null. */
export async function panelDataVolume(): Promise<string | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.name;

  // Ajan olarak çalışırken container adı kuruluma göre değişir; ownImage gibi
  // container'ın kendi hostname'i (kısa kimliği) de denenir.
  for (const candidate of [panelContainerName(), hostname()]) {
    try {
      const raw = (await getDockerProvider().inspectRaw(candidate)) as {
        Mounts?: { Type?: string; Name?: string; Destination?: string }[];
      } | null;
      if (!raw) continue;

      const mount = raw.Mounts?.find((entry) => entry.Destination === "/app/data");
      const name = mount?.Type === "volume" && mount.Name ? mount.Name : null;
      cached = { name, at: Date.now() };
      return name;
    } catch {
      // Sıradaki aday.
    }
  }
  return null;
}
