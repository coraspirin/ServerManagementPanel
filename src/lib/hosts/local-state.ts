import "server-only";

import { deleteCache, readCache, writeCache } from "@/lib/db/cache";
import { LOCAL_HOST_ID } from "./context";
import { decideLocal, probeLocalMounts, type LocalDecision, type LocalMounts } from "./local-probe";
import { getHost, updateHostMeta } from "./store";

/**
 * Yerel sunucunun açılıştaki etkinlik kararını uygular (kararlar.md D1).
 * "Panel kapattı" işareti `cache` tablosunda: mount'lar sonradan gelirse
 * yalnızca panelin kendi kapattığı yerel yeniden açılır.
 */
export const LOCAL_AUTO_DISABLED_KEY = "hosts:local-auto-disabled";

export type LocalProbeResult = { decision: LocalDecision; mounts: LocalMounts };

export function applyLocalProbe(mounts: LocalMounts = probeLocalMounts()): LocalProbeResult {
  const local = getHost(LOCAL_HOST_ID);
  if (!local) return { decision: "keep", mounts };
  const autoDisabled = readCache<boolean>(LOCAL_AUTO_DISABLED_KEY)?.value === true;
  const decision = decideLocal(mounts, { enabled: local.enabled, autoDisabled });
  if (decision === "disable") {
    updateHostMeta(LOCAL_HOST_ID, { enabled: false });
    writeCache(LOCAL_AUTO_DISABLED_KEY, true);
  } else if (decision === "enable") {
    updateHostMeta(LOCAL_HOST_ID, { enabled: true });
    deleteCache(LOCAL_AUTO_DISABLED_KEY);
  }
  return { decision, mounts };
}

/** Yerel sunucuyu panel mi kapattı? Karşılama ekranı nedenini göstermek için. */
export function localAutoDisabled(): boolean {
  return readCache<boolean>(LOCAL_AUTO_DISABLED_KEY)?.value === true;
}

/** Kullanıcı yereli elle açıp kapattı: artık karar onun, işaret düşer. */
export function clearLocalAutoDisabled(): void {
  deleteCache(LOCAL_AUTO_DISABLED_KEY);
}
