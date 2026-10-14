import { getDb } from "@/lib/db/client";
import { announce } from "@/lib/alerts/announce";
import { pruneAudit } from "@/lib/auth/audit";
import { pruneExpiredChallenges } from "@/lib/auth/twofactor";
import { runDueBackups } from "@/lib/backup/scheduler";
import { runAlertCycle } from "@/lib/alerts/engine";
import { pruneEvents } from "@/lib/alerts/store";
import { mqttConfigured, publishDiscovery, publishMetrics } from "@/lib/integration/publish";
import { collectDockerMetrics } from "@/lib/docker/collect";
import { collectLogs } from "@/lib/logs/collect";
import { pruneLogs } from "@/lib/logs/store";
import { collectMetrics } from "@/lib/metrics/collect";
import { runRollup } from "@/lib/metrics/rollup";
import { checkDueMonitors } from "@/lib/monitors/run";
import { pruneUptime } from "@/lib/monitors/store";
import { getDockerProvider } from "@/lib/providers";
import { refreshOui } from "@/lib/network/oui";
import { runScan } from "@/lib/network/scan";
import { pruneSpeedtests, runSpeedtest } from "@/lib/network/speedtest";
import { pruneScans, scanAllImages } from "@/lib/security/vuln";
import { scanListeningPorts } from "@/lib/security/ports";
import { scanPortForwards } from "@/lib/security/upnp";
import type { PruneScope } from "@/lib/providers/types";
import { getBool, getNumber, getString } from "@/lib/settings";
import { refreshImageUpdates } from "@/lib/updates";
import { serverT } from "@/lib/i18n/runtime";
import { fanOut, summarizeOutcomes } from "@/lib/hosts/fanout";
import { heartbeatAgents } from "@/lib/hosts/agents";
import { activeHosts, dockerHosts, getHost, listHosts } from "@/lib/hosts/store";
import { LOCAL_HOST_ID, runWithHost } from "@/lib/hosts/context";
import { syncRemoteEventWatchers } from "@/lib/docker/events";
import type { JobDefinition, JobResult } from "./types";

/**
 * Çoklu sunucu: işi her etkin sunucuda, o sunucunun bağlamında çalıştırır.
 * Tek sunuculu kurulumda sonuç ve hata davranışı eskisiyle aynı.
 */
function perHost(
  run: () => Promise<JobResult | void>,
  hosts: () => { id: number; name: string }[] = activeHosts,
): () => Promise<JobResult> {
  return async () => {
    const outcomes = await fanOut(hosts(), async () => (await run())?.detail);
    return { detail: summarizeOutcomes(outcomes) };
  };
}

/**
 * Kayıtlı işler — STATİK dizi, çalışma zamanında doldurulan bir Map değil.
 *
 * Sebebi (yaşanmış hata): Next'te instrumentation ile route handler'lar farklı
 * modül örneklerinde çalışabiliyor. İşler açılışta bir Map'e yazıldığında
 * /api/jobs bu Map'i boş görüyordu. Statik dizi her iki tarafta da aynı olur;
 * değişken durumun tamamı veritabanında tutulur.
 *
 * Her milestone kendi işini buraya ekler; zamanlaması settings.schema.ts'ten
 * gelir, koda sabit yazılmaz (T2/T9).
 */
export const jobDefinitions: JobDefinition[] = [
  {
    key: "metrics.collect",
    schedule: { kind: "interval", settingKey: "monitoring.collect_interval" },
    leaseSeconds: 30,
    // Saniyeler aralıkla çalışıyor; başarılı turlar geçmişi anlamsızlaştırır.
    recordSuccessRuns: false,
    scope: "perHost",
    run: perHost(async () => {
      const { written } = await collectMetrics();
      return { detail: serverT("jobs.detail.samples", { count: written }) };
    }),
  },
  {
    // Çoklu sunucu: uzak ajanların durumu, sürümü ve gecikmesi. Ajan yoksa
    // hiçbir şey yapmaz; çevrimdışı olan sunucu diğer işlerin dışında kalır.
    key: "hosts.heartbeat",
    schedule: { kind: "fixed", seconds: 15, labelKey: "jobs.schedule.heartbeat" },
    leaseSeconds: 60,
    recordSuccessRuns: false,
    async run() {
      const summary = await heartbeatAgents();
      // Olay izleyicileri durumu takip eder: çevrimiçi olana açılır, düşene kapanır.
      syncRemoteEventWatchers(listHosts());
      return {
        detail:
          serverT("jobs.detail.heartbeat", { online: summary.online, checked: summary.checked }) +
          (summary.changed.length > 0 ? ` · ${summary.changed.join(", ")}` : ""),
      };
    },
  },
  {
    key: "metrics.rollup",
    schedule: { kind: "cron", settingKey: "monitoring.rollup_cron" },
    leaseSeconds: 300,
    async run() {
      return { detail: runRollup().detail };
    },
  },
  {
    key: "docker.collect",
    schedule: { kind: "interval", settingKey: "docker.stats_interval" },
    leaseSeconds: 120,
    recordSuccessRuns: false,
    scope: "perHost",
    run: perHost(async () => {
      const { containers, running, written } = await collectDockerMetrics();
      return { detail: serverT("jobs.detail.dockerCollect", { running, containers, written }) };
    }, dockerHosts),
  },
  {
    key: "docker.autoprune",
    schedule: { kind: "cron", settingKey: "docker.autoprune.cron" },
    leaseSeconds: 600,
    scope: "perHost",
    run: perHost(async () => {
      // Varsayılan KAPALI: silinen bir image'ı geri getirmek yeniden indirmek
      // demek. İş yine de kayıtlı kalıyor ki kullanıcı ne zaman çalışacağını
      // Panel İşleri ekranından görebilsin.
      if (!getBool("docker.autoprune.enabled")) {
        return { detail: serverT("jobs.detail.autopruneOff") };
      }

      const scope = getString("docker.autoprune.scope") as PruneScope;
      const result = await getDockerProvider().prune(scope);
      return {
        detail: serverT("jobs.detail.pruned", {
          scope,
          removed: result.removed,
          mb: (result.reclaimedBytes / 1024 ** 2).toFixed(0),
        }),
      };
    }, dockerHosts),
  },
  {
    key: "monitors.check",
    // Her monitörün kendi aralığı `monitors` tablosunda; bu iş yalnızca
    // "zamanı gelen var mı" diye bakar. Kullanıcıya sunulacak bir tercih değil.
    schedule: { kind: "fixed", seconds: 10, labelKey: "jobs.schedule.monitors" },
    leaseSeconds: 120,
    recordSuccessRuns: false,
    async run() {
      const { checked, changes } = await checkDueMonitors();
      if (checked === 0) return { detail: serverT("jobs.detail.noMonitorsDue") };

      const summary = changes
        .map(
          (c) =>
            `${c.monitor.name}: ${c.inMaintenance ? serverT("jobs.detail.maintenance") : c.status}`,
        )
        .join(", ");
      return {
        detail: summary
          ? serverT("jobs.detail.monitorsChanged", { checked, summary })
          : serverT("jobs.detail.monitors", { checked }),
      };
    },
  },
  {
    key: "alerts.evaluate",
    // Tempo kullanıcı tercihi değil: eşiklerin kendisi ve doğrulama turu sayısı
    // ayarlardan geliyor, bu yalnızca "ne sıklıkla bakılacağı".
    schedule: { kind: "fixed", seconds: 30, labelKey: "jobs.schedule.alerts" },
    leaseSeconds: 120,
    recordSuccessRuns: false,
    // Her sunucunun metrikleri, monitörleri ve Docker'ı ayrı değerlendirilir;
    // olaylar ve bildirimler o sunucunun adıyla düşer.
    scope: "perHost",
    run: perHost(async () => {
      const summary = await runAlertCycle();
      const suppressed = Object.entries(summary.suppressed)
        .map(([reason, count]) => `${reason}:${count}`)
        .join(" ");

      if (summary.events === 0 && summary.notified === 0) {
        return { detail: serverT("jobs.detail.alertsNoChange", { evaluated: summary.evaluated }) };
      }
      return {
        detail:
          serverT("jobs.detail.alerts", {
            evaluated: summary.evaluated,
            events: summary.events,
            notified: summary.notified,
          }) + (suppressed ? serverT("jobs.detail.alertsSuppressed", { list: suppressed }) : ""),
      };
      // Çevrimdışı sunucular da: monitörleri merkezden denetleniyor ve o
      // sunucunun servisleri tam da bu durumda düşmüş olabilir. Ajana giden
      // kaynaklar (donanım, OS güncellemeleri) orada sessizce atlanır.
    }, () => listHosts().filter((host) => host.enabled)),
  },
  {
    key: "updates.images",
    schedule: { kind: "cron", settingKey: "updates.image_check_cron" },
    // Kayıt defterine ağ isteği; yavaş bir bağlantıda image başına saniyeler
    // sürebilir, bu yüzden kira süresi cömert.
    leaseSeconds: 600,
    scope: "perHost",
    run: perHost(async () => {
      const results = await refreshImageUpdates();
      const outdated = results.filter((entry) => entry.updateAvailable === true).length;
      const unknown = results.filter((entry) => entry.updateAvailable === null).length;
      return {
        detail:
          serverT("jobs.detail.images", { count: results.length, outdated }) +
          (unknown > 0 ? serverT("jobs.detail.imagesUnknown", { count: unknown }) : ""),
      };
    }, dockerHosts),
  },
  {
    key: "network.scan",
    schedule: { kind: "cron", settingKey: "network.scan_cron" },
    // Tarama /24 bir ağda dakikalar sürebiliyor; kira cömert olmalı yoksa
    // ikinci bir çalışan aynı turu baştan başlatır.
    leaseSeconds: 900,
    async run() {
      if (!getBool("network.scan_enabled")) return { detail: serverT("jobs.detail.scanOff") };

      // İlk turda envanter boş: HER cihaz "yeni" görünür ve bildirim yağmuru
      // olurdu. Bu yüzden bildirim yalnızca envanter zaten doluyken üretiliyor.
      const hadInventory =
        (getDb().prepare("SELECT COUNT(*) AS n FROM network_devices").get() as { n: number }).n > 0;

      const result = await runScan();
      if (!result.subnet) return { detail: serverT("jobs.detail.noSubnet") };

      if (hadInventory && getBool("network.alert_unknown")) {
        for (const device of result.newDevices) {
          await announce({
            alertKey: `network:${device.mac}`,
            source: "network",
            severity: "warning",
            title: serverT("jobs.announce.newDeviceTitle"),
            detail:
              `${device.ip} · ${device.mac}` +
              (device.vendor ? ` · ${device.vendor}` : "") +
              (device.hostname ? ` · ${device.hostname}` : "") +
              `\n\n${serverT("jobs.announce.newDeviceHint")}`,
          });
        }
      }

      return {
        detail:
          serverT("jobs.detail.scan", {
            subnet: result.subnet,
            scanned: result.scanned,
            alive: result.alive,
          }) +
          (result.newDevices.length
            ? serverT("jobs.detail.scanNew", { count: result.newDevices.length })
            : ""),
      };
    },
  },
  {
    key: "network.oui",
    schedule: { kind: "cron", settingKey: "network.oui_cron" },
    leaseSeconds: 600,
    async run() {
      return { detail: (await refreshOui()).message };
    },
  },
  {
    key: "network.speedtest",
    schedule: { kind: "cron", settingKey: "speedtest.cron" },
    leaseSeconds: 300,
    async run() {
      if (!getBool("speedtest.enabled")) return { detail: serverT("jobs.detail.speedtestOff") };

      const result = await runSpeedtest();
      pruneSpeedtests();

      if (!result.ok) throw new Error(result.error);
      return {
        detail: serverT("jobs.detail.speedtest", {
          // Ölçülemeyen yön `null` dönebiliyor; eski şablon da onu olduğu gibi
          // basıyordu, davranış korunuyor.
          down: String(result.downloadMbps),
          up: String(result.uploadMbps),
          ping: String(result.pingMs),
        }),
      };
    },
  },
  {
    key: "events.prune",
    schedule: { kind: "cron", settingKey: "jobs.events_prune_cron" },
    leaseSeconds: 120,
    async run() {
      return { detail: serverT("jobs.detail.eventsPruned", { count: pruneEvents() }) };
    },
  },
  {
    key: "uptime.prune",
    schedule: { kind: "cron", settingKey: "jobs.uptime_prune_cron" },
    leaseSeconds: 120,
    async run() {
      return { detail: serverT("jobs.detail.uptimePruned", { count: pruneUptime() }) };
    },
  },
  {
    key: "sessions.prune",
    schedule: { kind: "cron", settingKey: "jobs.sessions_prune_cron" },
    leaseSeconds: 60,
    async run() {
      const changes = getDb()
        .prepare("DELETE FROM sessions WHERE expires_at < unixepoch()")
        .run().changes;
      // İkinci adımı bekleyen yarım kalmış girişler de burada süpürülüyor:
      // aynı aileden kayıtlar, ayrı bir job açmaya değmez (M3.1).
      const challenges = pruneExpiredChallenges();
      return {
        detail:
          serverT("jobs.detail.sessionsPruned", { count: Number(changes) }) +
          (challenges > 0 ? serverT("jobs.detail.sessionsChallenges", { count: challenges }) : ""),
      };
    },
  },
  {
    key: "security.vuln_scan",
    schedule: { kind: "cron", settingKey: "jobs.vuln_scan_cron" },
    // İlk turda açık veritabanı indiriliyor; kilit bunu kapsayacak kadar uzun.
    leaseSeconds: 2 * 3600,
    async run() {
      const outcome = await scanAllImages();
      const pruned = pruneScans(getNumber("security.scan_retention_days"));
      return {
        detail:
          outcome.detail + (pruned > 0 ? serverT("jobs.detail.vulnPruned", { count: pruned }) : ""),
      };
    },
  },
  {
    key: "security.upnp_scan",
    schedule: { kind: "cron", settingKey: "jobs.upnp_scan_cron" },
    leaseSeconds: 120,
    async run() {
      const outcome = await scanPortForwards();
      return { detail: outcome.message };
    },
  },
  {
    key: "security.port_scan",
    schedule: { kind: "cron", settingKey: "jobs.port_scan_cron" },
    // Host ad alanında geçici bir container açıyor; normalde saniyeler sürer
    // ama imaj çekilmesi gerekirse uzayabilir.
    leaseSeconds: 180,
    scope: "perHost",
    run: perHost(async () => {
      const scan = await scanListeningPorts();
      // Hata yutulmuyor: önbellek eskiyip ekran sessizce yanlış "boş port"
      // önerirse, kullanıcı çakışan bir portu container'a verir.
      if (scan.error) throw new Error(scan.error);
      return { detail: serverT("jobs.detail.sockets", { count: scan.ports.length }) };
    }),
  },
  {
    key: "backup.scheduler",
    schedule: { kind: "cron", settingKey: "jobs.backup_scheduler_cron" },
    // Yedekler saatlerce sürebilir; kilit erken düşerse aynı iş ikinci kez
    // başlar ve restic depo kilidine takılır.
    leaseSeconds: 6 * 3600,
    // Depolar ve işler sunucuya bağlı; restic o sunucunun Docker'ında çalışır.
    scope: "perHost",
    run: perHost(async () => ({ detail: await runDueBackups() })),
  },
  {
    key: "logs.collect",
    schedule: { kind: "cron", settingKey: "jobs.logs_collect_cron" },
    // Konuşkan bir sistemde tur uzayabilir; kilit erken düşerse iki toplayıcı
    // aynı satırları çift yazar.
    leaseSeconds: 600,
    scope: "perHost",
    run: perHost(async () => {
      const outcome = await collectLogs();
      const parts = [
        serverT("jobs.detail.logs", { lines: outcome.collected, sources: outcome.sources }),
      ];
      if (outcome.matched > 0)
        parts.push(serverT("jobs.detail.logsMatched", { count: outcome.matched }));
      if (outcome.skipped.length > 0)
        parts.push(serverT("jobs.detail.logsSkipped", { list: outcome.skipped.join("; ") }));
      if (outcome.errors.length > 0)
        parts.push(serverT("jobs.detail.logsErrors", { list: outcome.errors.join("; ") }));
      return { detail: parts.join(" · ") };
    }),
  },
  {
    key: "logs.prune",
    schedule: { kind: "cron", settingKey: "jobs.logs_prune_cron" },
    leaseSeconds: 300,
    async run() {
      const outcome = pruneLogs(
        getNumber("logs.retention_days"),
        getNumber("logs.max_total_lines"),
      );
      return {
        detail:
          serverT("jobs.detail.logsPrunedAge", { count: outcome.removed }) +
          (outcome.bySize > 0
            ? serverT("jobs.detail.logsPrunedSize", { count: outcome.bySize })
            : ""),
      };
    },
  },
  {
    key: "mqtt.publish",
    schedule: { kind: "cron", settingKey: "jobs.mqtt_publish_cron" },
    leaseSeconds: 120,
    // Dakikalar aralıkla çalışıyor; başarılı turların geçmişi anlamsızlaştırır
    // (metrik toplamayla aynı gerekçe).
    recordSuccessRuns: false,
    async run() {
      if (!mqttConfigured()) return { detail: serverT("jobs.detail.mqttOff") };

      const result = await publishMetrics();
      // Keşif ilanları da her turda tazeleniyor: HA yeniden kurulduğunda ya da
      // saklanmış mesajlar temizlendiğinde entity'ler kendiliğinden geri gelsin.
      const discovery = getBool("integration.mqtt.discovery")
        ? await publishDiscovery()
        : { announced: 0 };

      return {
        detail:
          serverT("jobs.detail.mqtt", { count: result.topics }) +
          (discovery.announced > 0
            ? serverT("jobs.detail.mqttDiscovery", { count: discovery.announced })
            : ""),
      };
    },
  },
  {
    key: "audit.prune",
    schedule: { kind: "cron", settingKey: "jobs.audit_prune_cron" },
    leaseSeconds: 120,
    async run() {
      const months = getNumber("security.audit_retention_months");
      const changes = pruneAudit(months * 30);
      return { detail: serverT("jobs.detail.auditPruned", { count: changes, months }) };
    },
  },
];

/**
 * Yalnızca panelin kendi sunucusunda anlamlı merkezi işler (LAN, hız testi,
 * zafiyet/UPnP taraması, MQTT ile yerel metrik yayını). Açıkça yerel
 * bağlamda çalışırlar — bağlamsız kod artık varsayılan sunucuya (bir ajana
 * olabilir) düşüyor — ve yerel devre dışıysa atlanırlar (kararlar.md D1).
 */
const LOCAL_ONLY_JOBS = new Set([
  "network.scan",
  "network.speedtest",
  "security.vuln_scan",
  "security.upnp_scan",
  "mqtt.publish",
]);

for (const job of jobDefinitions) {
  if (!LOCAL_ONLY_JOBS.has(job.key)) continue;
  const run = job.run;
  job.run = async () => {
    if (getHost(LOCAL_HOST_ID)?.enabled !== true) return { detail: serverT("jobs.detail.localDisabled") };
    return runWithHost(LOCAL_HOST_ID, run);
  };
}

const byKey = new Map(jobDefinitions.map((job) => [job.key, job]));

export function findJob(key: string): JobDefinition | undefined {
  return byKey.get(key);
}
