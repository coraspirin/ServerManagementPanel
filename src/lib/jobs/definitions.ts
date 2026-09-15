import { getDb } from "@/lib/db/client";
import { describeDiscovery, discoveryEnabled, runDiscovery } from "@/lib/apps/discovery";
import { announce } from "@/lib/alerts/announce";
import { pruneApiTokens } from "@/lib/auth/apitoken";
import { pruneAudit } from "@/lib/auth/audit";
import { pruneExpiredChallenges } from "@/lib/auth/twofactor";
import { runDueBackups } from "@/lib/backup/engine";
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
import { checkCertificates } from "@/lib/proxy/certificates";
import { pruneScans, scanAllImages } from "@/lib/security/vuln";
import { scanListeningPorts } from "@/lib/security/ports";
import { scanPortForwards } from "@/lib/security/upnp";
import { tailscaleStatus } from "@/lib/tailscale/status";
import { syncDdns } from "@/lib/proxy/ddns";
import type { PruneScope } from "@/lib/providers/types";
import { getBool, getNumber, getString } from "@/lib/settings";
import { refreshImageUpdates } from "@/lib/updates";
import type { JobDefinition } from "./types";

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
    label: "Metrik toplama",
    description: "CPU, bellek, disk ve ağ örneklerini kaydeder.",
    schedule: { kind: "interval", settingKey: "monitoring.collect_interval" },
    leaseSeconds: 30,
    // Saniyeler aralıkla çalışıyor; başarılı turlar geçmişi anlamsızlaştırır.
    recordSuccessRuns: false,
    async run() {
      const { written } = await collectMetrics();
      return { detail: `${written} örnek` };
    },
  },
  {
    key: "metrics.rollup",
    label: "Metrik toplama & budama",
    description: "Ham metrikleri dakika/saat/gün katmanlarına toplar, süresi dolanı siler.",
    schedule: { kind: "cron", settingKey: "monitoring.rollup_cron" },
    leaseSeconds: 300,
    async run() {
      return { detail: runRollup().detail };
    },
  },
  {
    key: "docker.collect",
    label: "Container ölçümü",
    description: "Container CPU/bellek kullanımını ve yeniden başlatma sayacını kaydeder.",
    schedule: { kind: "interval", settingKey: "docker.stats_interval" },
    leaseSeconds: 120,
    recordSuccessRuns: false,
    async run() {
      const { containers, running, written } = await collectDockerMetrics();
      return { detail: `${running}/${containers} çalışıyor · ${written} ölçüm` };
    },
  },
  {
    key: "docker.autoprune",
    label: "Docker otomatik temizlik",
    description: "Ayarlarda seçilen kapsamda kullanılmayan Docker kaynaklarını siler.",
    schedule: { kind: "cron", settingKey: "docker.autoprune.cron" },
    leaseSeconds: 600,
    async run() {
      // Varsayılan KAPALI: silinen bir image'ı geri getirmek yeniden indirmek
      // demek. İş yine de kayıtlı kalıyor ki kullanıcı ne zaman çalışacağını
      // Panel İşleri ekranından görebilsin.
      if (!getBool("docker.autoprune.enabled")) {
        return { detail: "otomatik temizlik kapalı" };
      }

      const scope = getString("docker.autoprune.scope") as PruneScope;
      const result = await getDockerProvider().prune(scope);
      return {
        detail: `${scope}: ${result.removed} kaynak, ${(result.reclaimedBytes / 1024 ** 2).toFixed(0)} MB`,
      };
    },
  },
  {
    key: "monitors.check",
    label: "Servis kontrolü",
    description: "Zamanı gelen monitörleri yoklar ve durum değişimlerini kaydeder.",
    // Her monitörün kendi aralığı `monitors` tablosunda; bu iş yalnızca
    // "zamanı gelen var mı" diye bakar. Kullanıcıya sunulacak bir tercih değil.
    schedule: { kind: "fixed", seconds: 10, label: "sürekli (10 sn'de bir yoklama)" },
    leaseSeconds: 120,
    recordSuccessRuns: false,
    async run() {
      const { checked, changes } = await checkDueMonitors();
      if (checked === 0) return { detail: "sırada monitör yok" };

      const summary = changes
        .map((c) => `${c.monitor.name}: ${c.inMaintenance ? "bakım" : c.status}`)
        .join(", ");
      return { detail: `${checked} kontrol${summary ? ` · değişim → ${summary}` : ""}` };
    },
  },
  {
    key: "alerts.evaluate",
    label: "Alarm değerlendirme",
    description: "Eşikleri ve servis durumlarını denetler, gereken bildirimleri gönderir.",
    // Tempo kullanıcı tercihi değil: eşiklerin kendisi ve doğrulama turu sayısı
    // ayarlardan geliyor, bu yalnızca "ne sıklıkla bakılacağı".
    schedule: { kind: "fixed", seconds: 30, label: "sürekli (30 sn'de bir)" },
    leaseSeconds: 120,
    recordSuccessRuns: false,
    async run() {
      const summary = await runAlertCycle();
      const suppressed = Object.entries(summary.suppressed)
        .map(([reason, count]) => `${reason}:${count}`)
        .join(" ");

      if (summary.events === 0 && summary.notified === 0) {
        return { detail: `${summary.evaluated} koşul · değişiklik yok` };
      }
      return {
        detail:
          `${summary.evaluated} koşul · ${summary.events} olay · ${summary.notified} bildirim` +
          (suppressed ? ` · bastırılan ${suppressed}` : ""),
      };
    },
  },
  {
    key: "updates.images",
    label: "Image güncelleme kontrolü",
    description:
      "Container image'larının kayıt defterindeki sürümünü yereldekiyle karşılaştırır.",
    schedule: { kind: "cron", settingKey: "updates.image_check_cron" },
    // Kayıt defterine ağ isteği; yavaş bir bağlantıda image başına saniyeler
    // sürebilir, bu yüzden kira süresi cömert.
    leaseSeconds: 600,
    async run() {
      const results = await refreshImageUpdates();
      const outdated = results.filter((entry) => entry.updateAvailable === true).length;
      const unknown = results.filter((entry) => entry.updateAvailable === null).length;
      return {
        detail:
          `${results.length} container · ${outdated} güncelleme var` +
          (unknown > 0 ? ` · ${unknown} kontrol edilemedi` : ""),
      };
    },
  },
  {
    key: "apps.discover",
    label: "Kart keşfi",
    description:
      "Docker etiketlerinden uygulama kartı oluşturur, günceller ve etiketi kalkanları siler.",
    schedule: { kind: "cron", settingKey: "apps.discovery_cron" },
    leaseSeconds: 120,
    async run() {
      // Kapalıyken de iş kayıtlı kalıyor: kullanıcı Panel İşleri ekranında
      // "bu iş var ama çalışmıyor" görebilmeli (docker.autoprune ile aynı).
      if (!discoveryEnabled()) return { detail: "otomatik keşif kapalı" };
      return { detail: describeDiscovery(await runDiscovery()) };
    },
  },
  {
    key: "network.scan",
    label: "Ağ taraması",
    description: "Alt ağdaki cihazları yoklar, envanteri günceller ve yeni cihazı bildirir.",
    schedule: { kind: "cron", settingKey: "network.scan_cron" },
    // Tarama /24 bir ağda dakikalar sürebiliyor; kira cömert olmalı yoksa
    // ikinci bir çalışan aynı turu baştan başlatır.
    leaseSeconds: 900,
    async run() {
      if (!getBool("network.scan_enabled")) return { detail: "otomatik tarama kapalı" };

      // İlk turda envanter boş: HER cihaz "yeni" görünür ve bildirim yağmuru
      // olurdu. Bu yüzden bildirim yalnızca envanter zaten doluyken üretiliyor.
      const hadInventory =
        (getDb().prepare("SELECT COUNT(*) AS n FROM network_devices").get() as { n: number }).n > 0;

      const result = await runScan();
      if (!result.subnet) return { detail: "alt ağ belirlenemedi" };

      if (hadInventory && getBool("network.alert_unknown")) {
        for (const device of result.newDevices) {
          await announce({
            alertKey: `network:${device.mac}`,
            source: "network",
            severity: "warning",
            title: "Ağda yeni cihaz",
            detail:
              `${device.ip} · ${device.mac}` +
              (device.vendor ? ` · ${device.vendor}` : "") +
              (device.hostname ? ` · ${device.hostname}` : "") +
              "\n\nTanıdığın bir cihazsa Ağ ekranından işaretleyebilirsin.",
          });
        }
      }

      return {
        detail:
          `${result.subnet} · ${result.scanned} adres · ${result.alive} cihaz` +
          (result.newDevices.length ? ` · ${result.newDevices.length} yeni` : ""),
      };
    },
  },
  {
    key: "network.oui",
    label: "Üretici listesi güncelleme",
    description: "MAC adreslerini üreticiye çevirmek için kullanılan IEEE listesini tazeler.",
    schedule: { kind: "cron", settingKey: "network.oui_cron" },
    leaseSeconds: 600,
    async run() {
      return { detail: (await refreshOui()).message };
    },
  },
  {
    key: "network.speedtest",
    label: "Hız testi",
    description: "İnternet bağlantısının indirme/yükleme hızını ölçer ve geçmişe kaydeder.",
    schedule: { kind: "cron", settingKey: "speedtest.cron" },
    leaseSeconds: 300,
    async run() {
      if (!getBool("speedtest.enabled")) return { detail: "otomatik hız testi kapalı" };

      const result = await runSpeedtest();
      pruneSpeedtests();

      if (!result.ok) throw new Error(result.error);
      return {
        detail: `${result.downloadMbps} Mbit indirme · ${result.uploadMbps} Mbit yükleme · ${result.pingMs} ms`,
      };
    },
  },
  {
    key: "proxy.certificates",
    label: "Sertifika kontrolü",
    description: "Yayınlanan alan adlarının sertifika bitiş tarihlerini okur ve yaklaşanı bildirir.",
    schedule: { kind: "cron", settingKey: "proxy.cert_check_cron" },
    leaseSeconds: 300,
    async run() {
      const warnDays = getNumber("proxy.cert_warn_days");
      const result = await checkCertificates(warnDays);
      if (result.checked === 0) return { detail: "yayınlanan alan adı yok" };

      // Alarm motoruna değil `announce`a gidiyor: motor "koşul sürüyor mu"
      // defterini tutuyor, sertifika bitişi ise tek seferlik bir olay.
      for (const entry of result.expiring) {
        await announce({
          alertKey: `cert:${entry.domain}`,
          source: "proxy",
          severity: entry.daysLeft <= 7 ? "critical" : "warning",
          title: `Sertifika bitiyor: ${entry.domain}`,
          detail:
            entry.daysLeft < 0
              ? `${entry.domain} sertifikası ${-entry.daysLeft} gün önce doldu.`
              : `${entry.domain} sertifikasının bitmesine ${entry.daysLeft} gün kaldı.`,
        });
      }

      return {
        detail:
          `${result.checked} alan adı` +
          (result.expiring.length ? ` · ${result.expiring.length} bitiyor` : "") +
          (result.failed.length ? ` · ${result.failed.length} okunamadı` : ""),
      };
    },
  },
  {
    key: "proxy.ddns",
    label: "DDNS güncelleme",
    description: "Ev IP'si değiştiğinde dinamik DNS kayıtlarını günceller.",
    schedule: { kind: "cron", settingKey: "proxy.ddns_cron" },
    leaseSeconds: 120,
    recordSuccessRuns: false,
    async run() {
      const result = await syncDdns();

      // IP DEĞİŞİMİ olay kaydına düşüyor: dışarı açık bir servisin bir süre
      // ulaşılamamış olmasının sebebi çoğu zaman budur ve sonradan bakınca
      // zaman çizelgesinde görünmesi gerekir.
      for (const entry of result.updated) {
        await announce({
          alertKey: "ddns:ip",
          source: "ddns",
          severity: "info",
          title: "Genel IP değişti",
          detail: entry,
        });
      }

      const parts: string[] = [];
      if (result.updated.length) parts.push(`${result.updated.length} güncellendi`);
      if (result.unchanged.length) parts.push(`${result.unchanged.length} değişmedi`);
      if (result.failed.length) parts.push(`${result.failed.length} hata`);

      if (result.failed.length > 0) throw new Error(result.failed.join(" · "));
      return { detail: parts.length ? parts.join(" · ") : "kayıt yok" };
    },
  },
  {
    key: "tailscale.keys",
    label: "Tailscale anahtar kontrolü",
    description: "Düğüm anahtarı yakında dolacak cihazları bildirir.",
    schedule: { kind: "cron", settingKey: "tailscale.check_cron" },
    leaseSeconds: 120,
    async run() {
      const status = await tailscaleStatus();
      if (!status.available) return { detail: status.error ?? "tailscaled erişilemiyor" };

      for (const peer of status.expiring) {
        await announce({
          alertKey: `tailscale:${peer.id}`,
          source: "tailscale",
          severity: (peer.daysToExpiry ?? 0) <= 3 ? "critical" : "warning",
          title: `Tailscale anahtarı bitiyor: ${peer.hostname}`,
          detail:
            (peer.daysToExpiry ?? 0) < 0
              ? `${peer.hostname} anahtarı doldu; cihaz tailnet'ten düşmüş olabilir.`
              : `${peer.hostname} düğüm anahtarının bitmesine ${peer.daysToExpiry} gün kaldı. Süresi dolan cihaz tailnet'ten sessizce düşer.`,
        });
      }

      return {
        detail:
          `${status.peers.length + 1} düğüm` +
          (status.expiring.length ? ` · ${status.expiring.length} anahtar bitiyor` : ""),
      };
    },
  },
  {
    key: "events.prune",
    label: "Olay kaydı budama",
    description: "Saklama süresini aşan olay kayıtlarını siler.",
    schedule: { kind: "cron", settingKey: "jobs.events_prune_cron" },
    leaseSeconds: 120,
    async run() {
      return { detail: `${pruneEvents()} olay budandı` };
    },
  },
  {
    key: "uptime.prune",
    label: "Uptime budama",
    description: "Saklama süresini aşan servis durum kayıtlarını siler.",
    schedule: { kind: "cron", settingKey: "jobs.uptime_prune_cron" },
    leaseSeconds: 120,
    async run() {
      return { detail: `${pruneUptime()} kayıt budandı` };
    },
  },
  {
    key: "sessions.prune",
    label: "Oturum temizliği",
    description: "Süresi dolmuş oturum kayıtlarını siler.",
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
        detail: `${changes} oturum temizlendi` + (challenges > 0 ? `, ${challenges} yarım giriş` : ""),
      };
    },
  },
  {
    key: "api.tokens_prune",
    label: "API anahtarı budama",
    description: "İptal/süre dolumunun üzerinden saklama süresi geçmiş anahtarları siler.",
    schedule: { kind: "cron", settingKey: "jobs.api_tokens_prune_cron" },
    leaseSeconds: 60,
    async run() {
      return { detail: `${pruneApiTokens(getNumber("api.token_retention_days"))} anahtar budandı` };
    },
  },
  {
    key: "security.vuln_scan",
    label: "Güvenlik açığı taraması",
    description: "Çalışan container image'larını Trivy ile tarar (M3.8).",
    schedule: { kind: "cron", settingKey: "jobs.vuln_scan_cron" },
    // İlk turda açık veritabanı indiriliyor; kilit bunu kapsayacak kadar uzun.
    leaseSeconds: 2 * 3600,
    async run() {
      const outcome = await scanAllImages();
      const pruned = pruneScans(getNumber("security.scan_retention_days"));
      return {
        detail: outcome.detail + (pruned > 0 ? ` · ${pruned} eski kayıt budandı` : ""),
      };
    },
  },
  {
    key: "security.upnp_scan",
    label: "Port yönlendirme kontrolü",
    description: "Router'daki UPnP yönlendirmelerini okur, yenileri bildirir (M3.8).",
    schedule: { kind: "cron", settingKey: "jobs.upnp_scan_cron" },
    leaseSeconds: 120,
    async run() {
      const outcome = await scanPortForwards();
      return { detail: outcome.message };
    },
  },
  {
    key: "security.port_scan",
    label: "Port haritası taraması",
    description: "Dinleyen portları ve sahiplerini tarar, sonucu önbelleğe yazar (M3.17).",
    schedule: { kind: "cron", settingKey: "jobs.port_scan_cron" },
    // Host ad alanında geçici bir container açıyor; normalde saniyeler sürer
    // ama imaj çekilmesi gerekirse uzayabilir.
    leaseSeconds: 180,
    async run() {
      const scan = await scanListeningPorts();
      // Hata yutulmuyor: önbellek eskiyip ekran sessizce yanlış "boş port"
      // önerirse, kullanıcı çakışan bir portu container'a verir.
      if (scan.error) throw new Error(scan.error);
      return { detail: `${scan.ports.length} soket` };
    },
  },
  {
    key: "backup.scheduler",
    label: "Yedekleme zamanlayıcısı",
    description: "Vadesi gelen yedekleme işlerini çalıştırır (M3.4).",
    schedule: { kind: "cron", settingKey: "jobs.backup_scheduler_cron" },
    // Yedekler saatlerce sürebilir; kilit erken düşerse aynı iş ikinci kez
    // başlar ve restic depo kilidine takılır.
    leaseSeconds: 6 * 3600,
    async run() {
      return { detail: await runDueBackups() };
    },
  },
  {
    key: "logs.collect",
    label: "Log toplama",
    description: "Container ve journald loglarını arama indeksine yazar (M3.3).",
    schedule: { kind: "cron", settingKey: "jobs.logs_collect_cron" },
    // Konuşkan bir sistemde tur uzayabilir; kilit erken düşerse iki toplayıcı
    // aynı satırları çift yazar.
    leaseSeconds: 600,
    async run() {
      const outcome = await collectLogs();
      const parts = [`${outcome.collected} satır / ${outcome.sources} kaynak`];
      if (outcome.matched > 0) parts.push(`${outcome.matched} desen eşleşti`);
      if (outcome.skipped.length > 0) parts.push(`atlanan: ${outcome.skipped.join("; ")}`);
      if (outcome.errors.length > 0) parts.push(`hata: ${outcome.errors.join("; ")}`);
      return { detail: parts.join(" · ") };
    },
  },
  {
    key: "logs.prune",
    label: "Log budama",
    description: "Saklama süresini ve satır tavanını aşan log satırlarını siler.",
    schedule: { kind: "cron", settingKey: "jobs.logs_prune_cron" },
    leaseSeconds: 300,
    async run() {
      const outcome = pruneLogs(
        getNumber("logs.retention_days"),
        getNumber("logs.max_total_lines"),
      );
      return {
        detail:
          `${outcome.removed} satır yaşa göre` +
          (outcome.bySize > 0 ? `, ${outcome.bySize} satır tavana göre` : ""),
      };
    },
  },
  {
    key: "mqtt.publish",
    label: "MQTT yayını",
    description: "Panel metriklerini MQTT broker'ına basar (M3.11).",
    schedule: { kind: "cron", settingKey: "jobs.mqtt_publish_cron" },
    leaseSeconds: 120,
    // Dakikalar aralıkla çalışıyor; başarılı turların geçmişi anlamsızlaştırır
    // (metrik toplamayla aynı gerekçe).
    recordSuccessRuns: false,
    async run() {
      if (!mqttConfigured()) return { detail: "MQTT kapalı" };

      const result = await publishMetrics();
      // Keşif ilanları da her turda tazeleniyor: HA yeniden kurulduğunda ya da
      // saklanmış mesajlar temizlendiğinde entity'ler kendiliğinden geri gelsin.
      const discovery = getBool("integration.mqtt.discovery")
        ? await publishDiscovery()
        : { announced: 0 };

      return {
        detail:
          `${result.topics} konu yayınlandı` +
          (discovery.announced > 0 ? ` · ${discovery.announced} HA sensörü ilan edildi` : ""),
      };
    },
  },
  {
    key: "audit.prune",
    label: "Audit budama",
    description: "Saklama süresini aşan audit kayıtlarını siler.",
    schedule: { kind: "cron", settingKey: "jobs.audit_prune_cron" },
    leaseSeconds: 120,
    async run() {
      const months = getNumber("security.audit_retention_months");
      const changes = pruneAudit(months * 30);
      return { detail: `${changes} kayıt budandı (${months} ay öncesi)` };
    },
  },
];

const byKey = new Map(jobDefinitions.map((job) => [job.key, job]));

export function findJob(key: string): JobDefinition | undefined {
  return byKey.get(key);
}
