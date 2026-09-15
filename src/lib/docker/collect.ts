import "server-only";

import { getDb } from "@/lib/db/client";
import { getDockerProvider } from "@/lib/providers";
import { getNumber } from "@/lib/settings";

/**
 * M1.6 — container metriklerinin toplanması.
 *
 * Ölçümler ayrı bir tabloya değil `metrics_raw`'a yazılıyor (label = container
 * adı). Böylece T1'in rollup, budama, saklama ve grafik makinesi olduğu gibi
 * çalışıyor; ayrıca **restart-loop tespiti** de bedava geliyor: yeniden başlatma
 * sayacı bir zaman serisi olarak durduğu için "son 10 dakikada kaç kez arttı"
 * sorusu tek SQL sorgusu.
 *
 * Arayüz bu tablodan okur, canlı Docker API'sinden değil: `/stats` çağrısı
 * container başına ~1 saniye sürüyor ve sayfa açılışını bekletmesi anlamsız.
 */
export async function collectDockerMetrics(): Promise<{
  containers: number;
  running: number;
  written: number;
}> {
  const docker = getDockerProvider();
  const containers = await docker.list(true);

  const now = Math.floor(Date.now() / 1000);
  const rows: { metric: string; label: string; value: number }[] = [];

  await Promise.all(
    containers.map(async (container) => {
      const running = container.state === "running";
      rows.push({ metric: "docker.running", label: container.name, value: running ? 1 : 0 });

      // Yeniden başlatma sayacı yalnızca inspect'te var; loop tespiti buna dayanıyor.
      const [state, stats] = await Promise.all([
        docker.inspect(container.id).catch(() => null),
        running ? docker.stats(container.id).catch(() => null) : Promise.resolve(null),
      ]);

      if (state) {
        rows.push({
          metric: "docker.restart_count",
          label: container.name,
          value: state.restartCount,
        });
      }

      if (stats) {
        rows.push(
          { metric: "docker.cpu_pct", label: container.name, value: stats.cpuPct },
          { metric: "docker.mem_used", label: container.name, value: stats.memUsed },
          { metric: "docker.mem_pct", label: container.name, value: stats.memPct },
          // Ağ ve disk KÜMÜLATİF sayaç olarak yazılıyor, hız olarak değil.
          // Docker bunları container başlangıcından beri toplam bayt olarak
          // veriyor; hıza çevirmek iki örnek arasındaki farkı gerektiriyor ve
          // o işi arayüz yapıyor (bkz. rates() — sayaç sıfırlanmasını da orada
          // ele almak gerekiyor, container yeniden başlayınca sıfırdan sayıyor).
          { metric: "docker.net_rx", label: container.name, value: stats.netRxBytes },
          { metric: "docker.net_tx", label: container.name, value: stats.netTxBytes },
          { metric: "docker.blk_read", label: container.name, value: stats.blockReadBytes },
          { metric: "docker.blk_write", label: container.name, value: stats.blockWriteBytes },
        );
      }
    }),
  );

  if (rows.length > 0) {
    const db = getDb();
    const insert = db.prepare(
      `INSERT OR REPLACE INTO metrics_raw (host_id, metric, label, ts, value)
       VALUES (1, ?, ?, ?, ?)`,
    );

    db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) insert.run(row.metric, row.label, now, row.value);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    containers: containers.length,
    running: containers.filter((c) => c.state === "running").length,
    written: rows.length,
  };
}

export type RestartLoop = { container: string; restarts: number; windowMinutes: number };

/**
 * Restart-loop tespiti.
 *
 * Ev sunucularındaki en sinsi arıza: container "up" görünür, panelde yeşildir,
 * ama saniyeler içinde çöküp yeniden başlamaktadır. Tek bir anlık bakış bunu
 * göremez; yeniden başlatma sayacının ZAMAN İÇİNDEKİ artışı görür.
 */
export function detectRestartLoops(): RestartLoop[] {
  const windowMinutes = getNumber("docker.restart_loop.window");
  const threshold = getNumber("docker.restart_loop.threshold");
  const since = Math.floor(Date.now() / 1000) - windowMinutes * 60;

  const rows = getDb()
    .prepare(
      `SELECT label, MAX(value) - MIN(value) AS delta
       FROM metrics_raw
       WHERE metric = 'docker.restart_count' AND ts >= ?
       GROUP BY label
       HAVING delta >= ?`,
    )
    .all(since, threshold) as { label: string; delta: number }[];

  return rows.map((row) => ({
    container: row.label,
    restarts: Math.round(row.delta),
    windowMinutes,
  }));
}

/** Arayüz için son ölçümler: container adı → metrik → değer. */
export function latestContainerMetrics(): Map<string, Map<string, number>> {
  const interval = getNumber("docker.stats_interval");
  const since = Math.floor(Date.now() / 1000) - Math.max(interval * 4, 120);

  const rows = getDb()
    .prepare(
      `SELECT metric, label, value FROM metrics_raw
       WHERE metric LIKE 'docker.%' AND ts >= ? ORDER BY ts ASC`,
    )
    .all(since) as { metric: string; label: string; value: number }[];

  const byContainer = new Map<string, Map<string, number>>();
  for (const row of rows) {
    let metrics = byContainer.get(row.label);
    if (!metrics) {
      metrics = new Map();
      byContainer.set(row.label, metrics);
    }
    metrics.set(row.metric, row.value);
  }

  return byContainer;
}
