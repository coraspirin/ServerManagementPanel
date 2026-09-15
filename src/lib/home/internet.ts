import "server-only";

import { readCache, writeCache } from "@/lib/db/cache";
import { isMockMode } from "@/lib/env";
import { monitorViews } from "@/lib/monitors/store";
import { getString } from "@/lib/settings";

/**
 * M2.7 — "internet çalışıyor mu?" göstergesi.
 *
 * Ev halkının sorduğu soru "servis mi bozuk, internet mi gitti" ve bu ikisini
 * ayırt edemedikleri sürece her arıza aynı görünür. Bu yüzden gösterge İKİ
 * ayrı şey söylüyor: dışarıya çıkış var mı, ve evdeki servisler ayakta mı.
 *
 * Dış kontrol ayrı bir monitör olarak DEĞİL burada yapılıyor: monitör listesi
 * kullanıcıya ait ve silinebilir; ana sayfanın en büyük göstergesi kullanıcının
 * bir monitörü silmesiyle çalışmaz hale gelmemeli.
 */

const CACHE_KEY = "home:internet";
const CACHE_TTL = 60;
const TIMEOUT_MS = 5_000;

export type InternetStatus = {
  online: boolean;
  /** Kontrolün süresi (ms); çevrimdışıysa null. */
  latencyMs: number | null;
  checkedAt: number;
  /** Evdeki servislerin özeti. */
  servicesTotal: number;
  servicesDown: number;
};

async function probe(): Promise<{ online: boolean; latencyMs: number | null }> {
  if (isMockMode()) return { online: true, latencyMs: 18 };

  const url = getString("home.internet_check_url").trim();
  if (!url) return { online: false, latencyMs: null };

  const started = Date.now();
  try {
    // HEAD yeterli: gövdeyi indirmenin anlamı yok ve bazı hedefler büyük
    // sayfalar döndürüyor. Yönlendirme takip edilmiyor — 3xx de "ulaşılabilir"
    // demektir, hedefin nereye gittiği bizi ilgilendirmiyor.
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // 4xx/5xx bile bir CEVAPTIR: sunucuya ulaşıldıysa internet çalışıyordur.
    void response.status;
    return { online: true, latencyMs: Date.now() - started };
  } catch {
    return { online: false, latencyMs: null };
  }
}

export async function internetStatus(): Promise<InternetStatus> {
  const monitors = monitorViews(1);
  const enabled = monitors.filter((monitor) => monitor.enabled && !monitor.inMaintenance);
  const services = {
    servicesTotal: enabled.length,
    servicesDown: enabled.filter((monitor) => monitor.status === "down").length,
  };

  const cached = readCache<{ online: boolean; latencyMs: number | null }>(CACHE_KEY);
  const now = Math.floor(Date.now() / 1000);

  if (cached && now - cached.updatedAt < CACHE_TTL) {
    return { ...cached.value, checkedAt: cached.updatedAt, ...services };
  }

  const result = await probe();
  writeCache(CACHE_KEY, result);
  return { ...result, checkedAt: now, ...services };
}
