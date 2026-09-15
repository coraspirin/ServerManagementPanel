import "server-only";

import { getDb } from "@/lib/db/client";
import { panelContainerName } from "@/lib/host/self";
import { getDockerProvider } from "@/lib/providers";
import { getNumber, getString } from "@/lib/settings";
import { detectRestartLoops, latestContainerMetrics } from "./collect";
import { hidden, order } from "./labels";
import type { ContainerView, DockerOverview } from "./types";

/**
 * Container tablosunun veri modeli (M1.6).
 *
 * Liste canlı Docker API'sinden (tek çağrı, hızlı), ölçümler ise
 * `metrics_raw`'dan okunur. Ölçümü de canlı çekmek sayfa açılışını container
 * başına ~1 saniye bekletirdi.
 */
export async function dockerOverview(): Promise<DockerOverview> {
  const windowMinutes = getNumber("docker.restart_loop.window");

  let summaries;
  try {
    summaries = await getDockerProvider().list(true);
  } catch (error) {
    return {
      containers: [],
      statsAt: null,
      error:
        error instanceof Error
          ? `Docker'a erişilemedi: ${error.message}`
          : "Docker'a erişilemedi.",
    };
  }

  const metrics = latestContainerMetrics();
  const loops = new Map(detectRestartLoops().map((loop) => [loop.container, loop.restarts]));

  /**
   * `panel.hidden=true` olanlar listeden düşürülüyor (M3.27).
   *
   * SUNUCU tarafında süzülüyor, arayüzde değil: gizlemenin amacı listeyi
   * sadeleştirmek ve gizlenen container yine de Docker CLI'dan yönetilebiliyor.
   * İstemciye gönderip orada saklamak, "gizli" olanı ağ trafiğinde ve tarayıcı
   * belleğinde bırakmak olurdu.
   */
  const gorunur = summaries.filter((summary) => !hidden(summary.labels));

  // Emniyet kilidi (M3.27/M3.30): panelin kendisi ve reverse proxy. Etiketle
  // açılamıyor — bu bir tercih değil, panelin ayakta kalma koşulu.
  const kilitli = new Set([panelContainerName(), getString("proxy.caddy_container").trim()]);
  kilitli.delete("");

  const containers: ContainerView[] = gorunur.map((summary) => {
    const values = metrics.get(summary.name);
    return {
      ...summary,
      cpuPct: values?.get("docker.cpu_pct") ?? null,
      memUsed: values?.get("docker.mem_used") ?? null,
      memPct: values?.get("docker.mem_pct") ?? null,
      restartCount: values?.get("docker.restart_count") ?? null,
      netRx: values?.get("docker.net_rx") ?? null,
      netTx: values?.get("docker.net_tx") ?? null,
      blkRead: values?.get("docker.blk_read") ?? null,
      blkWrite: values?.get("docker.blk_write") ?? null,
      restartsInWindow: loops.get(summary.name) ?? 0,
      restartLoopWindowMinutes: windowMinutes,
      order: order(summary.labels),
      locked: kilitli.has(summary.name),
    };
  });

  // `panel.order` küçükten büyüğe; eşitlerde ada göre. Sağlayıcı zaten ada
  // göre sıralı döndürüyor, bu yüzden kararlı sıralama yeterli.
  containers.sort((a, b) => a.order - b.order);

  const row = getDb()
    .prepare("SELECT MAX(ts) AS ts FROM metrics_raw WHERE metric LIKE 'docker.%'")
    .get() as { ts: number | null } | undefined;

  return { containers, statsAt: row?.ts ?? null, error: null };
}
