import "server-only";

import { unacknowledgedCount } from "@/lib/alerts/store";
import { getDb } from "@/lib/db/client";
import { latestSnapshot } from "@/lib/metrics/collect";
import { listMonitors } from "@/lib/monitors/store";
import { currentDictionary } from "@/lib/i18n/runtime";
import { translateLoose } from "@/lib/i18n/translate";
import { getDockerProvider } from "@/lib/providers";

/**
 * M3.11 — panelin dışarı verdiği durumun TEK kaynağı.
 *
 * Prometheus ucu ve MQTT yayını aynı listeden besleniyor. İki ayrı yerde
 * toplansaydı biri diğerinden sapardı: "Grafana'da disk %81 ama Home
 * Assistant'ta %79" gibi, sebebi haftalarca bulunamayacak bir tutarsızlık.
 * Burada toplanır, iki biçimlendirici yalnızca sunumu değiştirir.
 */

export type Sample = {
  /** Prometheus adı; `panel_` öneki burada, tek yerde veriliyor. */
  name: string;
  help: string;
  type: "gauge" | "counter";
  labels: Record<string, string>;
  value: number;
  /** MQTT tarafında birim gösterimi ve HA keşfi için. */
  unit?: string;
};

function push(
  into: Sample[],
  name: string,
  value: number | null | undefined,
  options: { labels?: Record<string, string>; type?: "gauge" | "counter"; unit?: string } = {},
): void {
  // null metrik YAZILMIYOR: Prometheus'ta "değer yok" diye bir şey yok ve
  // sıfır yazmak "CPU %0" yalanı olurdu. Örnek hiç toplanmadıysa seri de
  // görünmez — grafikte boşluk, uydurma bir düz çizgiden dürüsttür.
  if (value === null || value === undefined || !Number.isFinite(value)) return;
  into.push({
    name,
    // Açıklama dil dosyasından: MQTT'de Home Assistant'ın varlık adı oluyor.
    help: translateLoose(currentDictionary(), `metricsHelp.${name}`),
    type: options.type ?? "gauge",
    labels: options.labels ?? {},
    value,
    unit: options.unit,
  });
}

export async function collectSamples(): Promise<Sample[]> {
  const samples: Sample[] = [];
  const snapshot = latestSnapshot();

  push(samples, "panel_cpu_percent", snapshot.cpuPct, {
    unit: "%",
  });
  push(samples, "panel_cpu_iowait_percent", snapshot.cpuIowaitPct, {
    unit: "%",
  });
  push(samples, "panel_memory_percent", snapshot.memUsedPct, {
    unit: "%",
  });
  push(samples, "panel_memory_used_bytes", snapshot.memUsed, {
    unit: "B",
  });
  push(samples, "panel_memory_total_bytes", snapshot.memTotal, { unit: "B" });
  push(samples, "panel_swap_percent", snapshot.swapUsedPct, {
    unit: "%",
  });
  push(samples, "panel_load1", snapshot.load1);
  push(samples, "panel_load5", snapshot.load5);
  push(samples, "panel_load15", snapshot.load15);
  push(samples, "panel_uptime_seconds", snapshot.uptimeSeconds, {
    unit: "s",
  });

  for (const disk of snapshot.disks) {
    const labels = { mount: disk.mount };
    push(samples, "panel_disk_percent", disk.usedPct, {
      labels,
      unit: "%",
    });
    push(samples, "panel_disk_used_bytes", disk.used, { labels, unit: "B" });
    push(samples, "panel_disk_free_bytes", disk.free, { labels, unit: "B" });
    push(samples, "panel_disk_total_bytes", disk.total, { labels, unit: "B" });
  }

  for (const iface of snapshot.interfaces) {
    const labels = { interface: iface.name };
    push(samples, "panel_network_rx_bytes_per_second", iface.rxBps, {
      labels,
      unit: "B/s",
    });
    push(samples, "panel_network_tx_bytes_per_second", iface.txBps, {
      labels,
      unit: "B/s",
    });
  }

  // Docker erişilemezse metriklerin tamamı düşmüyor: container bölümü eksik
  // kalır, sistem metrikleri yerinde durur. Scrape'i tümden başarısız yapmak,
  // Grafana'da CPU grafiğini de karartmak olurdu.
  try {
    const containers = await getDockerProvider().list(true);
    push(samples, "panel_containers_total", containers.length);
    push(
      samples,
      "panel_containers_running",
      containers.filter((container) => container.state === "running").length,
    );
    for (const container of containers) {
      push(
        samples,
        "panel_container_up",
        container.state === "running" ? 1 : 0,
        { labels: { container: container.name } },
      );
    }
  } catch {
    push(samples, "panel_docker_reachable", 0);
  }

  for (const monitor of listMonitors()) {
    if (!monitor.enabled) continue;
    const labels = { monitor: monitor.name, type: monitor.type };
    // "bilinmiyor" 0 yazılmıyor: hiç kontrol edilmemiş bir servisi "kapalı"
    // diye raporlamak yanlış alarm üretirdi.
    if (monitor.status !== "bilinmiyor") {
      push(samples, "panel_monitor_up", monitor.status === "up" ? 1 : 0, {
        labels,
      });
    }
    push(samples, "panel_monitor_latency_ms", monitor.lastLatencyMs, {
      labels,
      unit: "ms",
    });
  }

  push(
    samples,
    "panel_events_unacknowledged",
    unacknowledgedCount(),
  );

  // İş durumları `jobStatuses()` yerine DOĞRUDAN tablodan okunuyor.
  //
  // Sebebi teknik: `jobs/runner` → `jobs/definitions` → `alerts/announce` →
  // (M3.11) otomasyon motoru → burası şeklinde bir modül döngüsü oluşuyordu.
  // ESM döngüyü çökmeden yükler ama sıraya bağlı olarak bir modül henüz
  // tanımlanmamış bir dışa aktarım görebilir — üretimde ancak belirli bir
  // giriş noktasında ortaya çıkan türden bir hata. Buradaki tek ihtiyaç iki
  // sayaç; onlar için tablo zaten yeterli.
  const jobs = getDb()
    .prepare(
      `SELECT key, last_status, last_finish_at, fail_count FROM jobs`,
    )
    .all() as {
    key: string;
    last_status: string;
    last_finish_at: number | null;
    fail_count: number;
  }[];

  push(samples, "panel_jobs_total", jobs.length);
  push(
    samples,
    "panel_jobs_failing",
    jobs.filter((job) => job.last_status === "hata").length,
  );
  for (const job of jobs) {
    push(samples, "panel_job_last_run_timestamp", job.last_finish_at, {
      labels: { job: job.key },
      unit: "s",
    });
    push(samples, "panel_job_fail_total", job.fail_count, {
      labels: { job: job.key },
      type: "counter",
    });
  }

  return samples;
}
