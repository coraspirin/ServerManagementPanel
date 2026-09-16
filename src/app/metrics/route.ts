import { serverT } from "@/lib/i18n/runtime";
import { guardV1 } from "@/lib/apiv1/guard";
import { apiError } from "@/lib/apiv1/respond";
import { dockerOverview } from "@/lib/docker/view";
import { latestSnapshot } from "@/lib/metrics/collect";
import { monitorViews } from "@/lib/monitors/store";
import { currentDictionary } from "@/lib/i18n/runtime";
import { translateLoose } from "@/lib/i18n/translate";
import { getBool } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Prometheus text exposition (T12).
 *
 * YÜK KURALI: `node:sqlite` SENKRON — bir sorgu event loop'unu bloklar. Diğer
 * uçlarda bu sorun değil (kullanıcı tıkladıkça çağrılıyorlar), ama Prometheus
 * 15 saniyede bir, sonsuza kadar scrape eder. Bu yüzden exposition YALNIZCA
 * hazır kaynaklardan besleniyor — `latestSnapshot()` zaten dar bir pencereyi
 * okuyor, `dockerOverview()` ölçümleri `metrics_raw`ın son satırlarından
 * alıyor. Ham tablo taraması ya da aralık sorgusu BURAYA GİRMEZ; gerekirse
 * bir job'ın önceden hesapladığı `cache` satırına konur.
 *
 * KARDİNALİTE: etiketlerde container ADI kullanılıyor, id DEĞİL. Id her
 * recreate'te değişir ve Prometheus için her seferinde yepyeni bir zaman
 * serisi demektir — birkaç güncelleme sonra grafiklerde kopuk çizgiler ve
 * şişmiş bir TSDB. Aynı sebeple imaj digest'i, log satırı gibi yüksek
 * kardinaliteli hiçbir alan etikete konmaz.
 */

/** Etiket değerinde kaçırılması gereken üç karakter (exposition biçimi). */
function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

type Line = { name: string; help: string; type: "gauge" | "counter"; samples: string[] };

function render(blocks: Line[]): string {
  const out: string[] = [];
  for (const block of blocks) {
    if (block.samples.length === 0) continue;
    out.push(`# HELP ${block.name} ${block.help}`);
    out.push(`# TYPE ${block.name} ${block.type}`);
    out.push(...block.samples);
  }
  return out.join("\n") + "\n";
}

/** null ölçümler ATLANIR — Prometheus'ta "veri yok" 0 değildir. */
/** HELP satırı dil dosyasından (`metricsHelp.<ad>`). */
function metricHelp(name: string): string {
  return translateLoose(currentDictionary(), `metricsHelp.${name}`);
}

function gauge(name: string, value: number | null, labels = ""): Line {
  return {
    name,
    help: metricHelp(name),
    type: "gauge",
    samples: value === null ? [] : [`${name}${labels} ${value}`],
  };
}

export async function GET(request: Request) {
  // Şalter kontrolü guardV1'in içinde; ayrıca Prometheus'un kendi anahtarı
  // da açık olmalı (hiyerarşik — /metrics de bearer ile kimlik doğruluyor,
  // ana şalter kapalıyken token çözümleme yolu hiç çalışmıyor).
  const guard = await guardV1(request, "metrics.view");
  if (!guard.ok) return guard.response;

  if (!getBool("integration.prometheus.enabled")) {
    return apiError("not_found", serverT("api.v1.prometheusOff"));
  }

  const snapshot = latestSnapshot();
  const blocks: Line[] = [
    gauge("panel_cpu_usage_percent", snapshot.cpuPct),
    gauge("panel_cpu_iowait_percent", snapshot.cpuIowaitPct),
    gauge("panel_memory_used_percent", snapshot.memUsedPct),
    gauge("panel_memory_used_bytes", snapshot.memUsed),
    gauge("panel_memory_total_bytes", snapshot.memTotal),
    gauge("panel_swap_used_percent", snapshot.swapUsedPct),
    gauge("panel_load1", snapshot.load1),
    gauge("panel_load5", snapshot.load5),
    gauge("panel_load15", snapshot.load15),
    gauge("panel_uptime_seconds", snapshot.uptimeSeconds),
    {
      name: "panel_disk_used_percent",
      help: metricHelp("panel_disk_used_percent"),
      type: "gauge",
      samples: snapshot.disks.map(
        (disk) => `panel_disk_used_percent{mount="${escapeLabel(disk.mount)}"} ${disk.usedPct}`,
      ),
    },
    {
      name: "panel_disk_free_bytes",
      help: metricHelp("panel_disk_free_bytes"),
      type: "gauge",
      samples: snapshot.disks.map(
        (disk) => `panel_disk_free_bytes{mount="${escapeLabel(disk.mount)}"} ${disk.free}`,
      ),
    },
    {
      name: "panel_network_receive_bytes_per_second",
      help: metricHelp("panel_network_receive_bytes_per_second"),
      type: "gauge",
      samples: snapshot.interfaces.map(
        (item) =>
          `panel_network_receive_bytes_per_second{device="${escapeLabel(item.name)}"} ${item.rxBps}`,
      ),
    },
    {
      name: "panel_network_transmit_bytes_per_second",
      help: metricHelp("panel_network_transmit_bytes_per_second"),
      type: "gauge",
      samples: snapshot.interfaces.map(
        (item) =>
          `panel_network_transmit_bytes_per_second{device="${escapeLabel(item.name)}"} ${item.txBps}`,
      ),
    },
  ];

  // Monitörler: `days` şeridi hesaplanmasın diye 0 gün.
  const monitors = monitorViews(0);
  blocks.push(
    {
      name: "panel_monitor_up",
      help: metricHelp("panel_monitor_up"),
      type: "gauge",
      samples: monitors
        .filter((monitor) => monitor.status !== "bilinmiyor")
        .map(
          (monitor) =>
            `panel_monitor_up{monitor="${escapeLabel(monitor.name)}",type="${escapeLabel(monitor.type)}"} ${monitor.status === "up" ? 1 : 0}`,
        ),
    },
    {
      name: "panel_monitor_latency_ms",
      help: metricHelp("panel_monitor_latency_ms"),
      type: "gauge",
      samples: monitors
        .filter((monitor) => monitor.lastLatencyMs !== null)
        .map(
          (monitor) =>
            `panel_monitor_latency_ms{monitor="${escapeLabel(monitor.name)}"} ${monitor.lastLatencyMs}`,
        ),
    },
  );

  if (getBool("integration.prometheus.include_containers")) {
    const overview = await dockerOverview();
    if (overview.error === null) {
      blocks.push(
        {
          name: "panel_container_running",
          help: metricHelp("panel_container_running"),
          type: "gauge",
          samples: overview.containers.map(
            (container) =>
              `panel_container_running{name="${escapeLabel(container.name)}"} ${container.state === "running" ? 1 : 0}`,
          ),
        },
        {
          name: "panel_container_cpu_percent",
          help: metricHelp("panel_container_cpu_percent"),
          type: "gauge",
          samples: overview.containers
            .filter((container) => container.cpuPct !== null)
            .map(
              (container) =>
                `panel_container_cpu_percent{name="${escapeLabel(container.name)}"} ${container.cpuPct}`,
            ),
        },
        {
          name: "panel_container_memory_used_bytes",
          help: metricHelp("panel_container_memory_used_bytes"),
          type: "gauge",
          samples: overview.containers
            .filter((container) => container.memUsed !== null)
            .map(
              (container) =>
                `panel_container_memory_used_bytes{name="${escapeLabel(container.name)}"} ${container.memUsed}`,
            ),
        },
        {
          name: "panel_container_restart_count",
          help: metricHelp("panel_container_restart_count"),
          type: "counter",
          samples: overview.containers
            .filter((container) => container.restartCount !== null)
            .map(
              (container) =>
                `panel_container_restart_count{name="${escapeLabel(container.name)}"} ${container.restartCount}`,
            ),
        },
      );
    }
  }

  return new Response(render(blocks), {
    headers: {
      // Prometheus 0.0.4 metin biçimi.
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Panel-Api-Version": "1",
    },
  });
}
