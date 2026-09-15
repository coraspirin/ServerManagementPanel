import "server-only";

import { backupStatus } from "@/lib/backup/watch";
import { getDb } from "@/lib/db/client";
import { detectRestartLoops } from "@/lib/docker/collect";
import { formatBytes, formatPct } from "@/lib/metrics/catalog";
import { latestSnapshot } from "@/lib/metrics/collect";
import { diskForecasts, isActionable } from "@/lib/metrics/forecast";
import { listMonitors } from "@/lib/monitors/store";
import { getHardwareProvider } from "@/lib/providers";
import type { HardwareReport } from "@/lib/providers/types";
import { getBool, getNumber, getString } from "@/lib/settings";
import { cachedImageUpdates } from "@/lib/updates";
import { osUpdateReport } from "@/lib/updates/os";
import type { Severity } from "./types";

/**
 * M1.3 — o anki alarm koşulları.
 *
 * Bu modül YALNIZCA "şu an durum ne" sorusuna cevap verir; bildirme kararı,
 * bastırma ve tekrar mantığı engine.ts'te. Ayrımın sebebi: yeni bir alarm
 * kaynağı eklemek (M1.4 sıcaklık/S.M.A.R.T, M1.5 kapasite, M1.6 restart-loop)
 * buraya bir fonksiyon yazmak olsun, durum makinesine dokunmak olmasın.
 */

export type Condition = {
  /** Aynı sorunun tekrarını tanıyan kimlik. */
  key: string;
  source: "monitor" | "metric" | "system";
  severity: Severity;
  title: string;
  detail: string;
  /** Bakım penceresi kapsamı için — yalnızca monitör kaynaklı koşullarda. */
  monitorId?: number;
  /**
   * İlgili container adı (M1.8). Doluysa o container'ın runbook notu
   * bildirime eklenir: telefona düşen mesaj sorunu ve ilk adımı birlikte
   * taşısın.
   */
  container?: string;
};

/** Eşiklere göre seviye. Eşikler ayarlardan gelir (İlkeler #5). */
function levelFor(value: number, warn: number, crit: number): Severity {
  if (value >= crit) return "critical";
  if (value >= warn) return "warning";
  return "ok";
}

/**
 * Son N saniyenin ortalaması.
 *
 * CPU için anlık örnek kullanılamaz: tek bir derleme ya da yedekleme %100'e
 * vurur ve her seferinde alarm üretirdi. Ortalama, "gerçekten yük altında"
 * ile "bir an sıçradı"yı ayırır. Bellek ve disk için anlık değer yeterli,
 * onlar bu şekilde zıplamaz.
 */
function averageOf(metric: string, label: string, seconds: number): number | null {
  const row = getDb()
    .prepare(
      `SELECT AVG(value) AS avg, COUNT(*) AS n FROM metrics_raw
       WHERE metric = ? AND label = ? AND ts >= unixepoch() - ?`,
    )
    .get(metric, label, seconds) as { avg: number | null; n: number };

  return row.n > 0 ? row.avg : null;
}

const CPU_WINDOW_SECONDS = 300;

function metricConditions(): Condition[] {
  const conditions: Condition[] = [];
  const snapshot = latestSnapshot();

  const cpuAverage = averageOf("cpu.pct", "", CPU_WINDOW_SECONDS);
  if (cpuAverage !== null) {
    const severity = levelFor(
      cpuAverage,
      getNumber("alerts.cpu.warn"),
      getNumber("alerts.cpu.crit"),
    );
    conditions.push({
      key: "metric:cpu",
      source: "metric",
      severity,
      title:
        severity === "ok"
          ? "İşlemci yükü normale döndü"
          : `İşlemci yükü yüksek (${formatPct(cpuAverage)})`,
      detail: `Son 5 dakikanın ortalaması ${formatPct(cpuAverage)}. Uyarı eşiği %${getNumber("alerts.cpu.warn")}, kritik eşik %${getNumber("alerts.cpu.crit")}.`,
    });
  }

  if (snapshot.memUsedPct !== null) {
    const severity = levelFor(
      snapshot.memUsedPct,
      getNumber("alerts.ram.warn"),
      getNumber("alerts.ram.crit"),
    );
    const used = snapshot.memUsed === null ? "" : ` (${formatBytes(snapshot.memUsed)}`;
    const total = snapshot.memTotal === null ? "" : ` / ${formatBytes(snapshot.memTotal)})`;
    conditions.push({
      key: "metric:ram",
      source: "metric",
      severity,
      title:
        severity === "ok"
          ? "Bellek kullanımı normale döndü"
          : `Bellek kullanımı yüksek (${formatPct(snapshot.memUsedPct)})`,
      detail: `Kullanım ${formatPct(snapshot.memUsedPct)}${used}${total}.`,
    });
  }

  for (const disk of snapshot.disks) {
    const severity = levelFor(
      disk.usedPct,
      getNumber("alerts.disk.warn"),
      getNumber("alerts.disk.crit"),
    );
    conditions.push({
      key: `metric:disk:${disk.mount}`,
      source: "metric",
      severity,
      title:
        severity === "ok"
          ? `${disk.mount} doluluğu normale döndü`
          : `${disk.mount} doluyor (${formatPct(disk.usedPct)})`,
      detail: `${formatBytes(disk.used)} / ${formatBytes(disk.total)} kullanımda, ${formatBytes(disk.free)} boş.`,
    });
  }

  return conditions;
}

function monitorConditions(): Condition[] {
  return listMonitors()
    .filter((monitor) => monitor.enabled && monitor.status !== "bilinmiyor")
    .map((monitor) => ({
      key: `monitor:${monitor.id}`,
      source: "monitor" as const,
      monitorId: monitor.id,
      severity: monitor.status === "down" ? ("critical" as Severity) : ("ok" as Severity),
      title:
        monitor.status === "down"
          ? `${monitor.name} yanıt vermiyor`
          : `${monitor.name} yeniden çalışıyor`,
      detail:
        monitor.status === "down"
          ? `${monitor.target} — ${monitor.lastError ?? "yanıt yok"}`
          : `${monitor.target} — ${monitor.lastLatencyMs ?? "?"} ms`,
      // `container` tipi monitörde hedef, container adının ta kendisidir —
      // runbook notu doğrudan eşleşir.
      container: monitor.type === "container" ? monitor.target : undefined,
    }));
}

// --- Donanım (M1.4) --------------------------------------------------------

function hardwareConditions(report: HardwareReport): Condition[] {
  const conditions: Condition[] = [];
  const now = Math.floor(Date.now() / 1000);

  // Sıcaklık. Sensör kendi eşiğini bildiriyorsa onu kullanıyoruz: bir NVMe'nin
  // 74 °C'si normal, bir CPU'nun 74 °C'si sınırda. Tek bir global eşik ikisini
  // de yanlış değerlendirirdi.
  const wanted = getString("hardware.temp_sources")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const reading of report.temperatures) {
    if (wanted.length > 0 && !wanted.includes(reading.id)) continue;

    const warn = reading.highC ?? getNumber("alerts.temp.warn");
    const crit = reading.criticalC ?? getNumber("alerts.temp.crit");
    const severity = levelFor(reading.celsius, warn, crit);

    conditions.push({
      key: `hardware:temp:${reading.id}`,
      source: "system",
      severity,
      title:
        severity === "ok"
          ? `${reading.source} ${reading.label} sıcaklığı normale döndü`
          : `${reading.source} ${reading.label} sıcak (${reading.celsius} °C)`,
      detail: `Ölçüm ${reading.celsius} °C. Uyarı ${warn} °C, kritik ${crit} °C${reading.highC !== null ? " (sensörün kendi eşikleri)" : ""}.`,
    });
  }

  // S.M.A.R.T. "FAILED" diskin kendi kendini arızalı ilan etmesidir — kritik.
  // Yeniden atanan/bekleyen sektörler henüz arıza değil ama habercisidir.
  for (const disk of report.disks) {
    const failed = disk.health === "FAILED";
    const bad =
      (disk.reallocatedSectors ?? 0) > 0 ||
      (disk.pendingSectors ?? 0) > 0 ||
      (disk.uncorrectableErrors ?? 0) > 0;

    const severity: Severity = failed ? "critical" : bad ? "warning" : "ok";
    const counters = [
      disk.reallocatedSectors !== null ? `yeniden atanan sektör: ${disk.reallocatedSectors}` : null,
      disk.pendingSectors !== null ? `bekleyen sektör: ${disk.pendingSectors}` : null,
      disk.uncorrectableErrors !== null ? `düzeltilemeyen: ${disk.uncorrectableErrors}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    conditions.push({
      key: `hardware:smart:${disk.device}`,
      source: "system",
      severity,
      title: failed
        ? `${disk.device} S.M.A.R.T arızası bildiriyor`
        : bad
          ? `${disk.device} disk hatası biriktiriyor`
          : `${disk.device} sağlık durumu normale döndü`,
      detail: `${disk.model} — durum ${disk.health}. ${counters}`,
    });
  }

  // RAID/ZFS havuzu.
  const overdueSeconds = getNumber("hardware.raid.scrub_overdue_days") * 86400;
  for (const pool of report.pools) {
    const scrubOverdue =
      pool.lastScrubAt !== null && now - pool.lastScrubAt > overdueSeconds;
    const severity: Severity = !pool.healthy ? "critical" : scrubOverdue ? "warning" : "ok";

    conditions.push({
      key: `hardware:pool:${pool.name}`,
      source: "system",
      severity,
      title: !pool.healthy
        ? `${pool.name} havuzu bozulmuş (${pool.state})`
        : scrubOverdue
          ? `${pool.name} havuzu uzun süredir doğrulanmadı`
          : `${pool.name} havuzu normale döndü`,
      detail:
        `${pool.kind.toUpperCase()} · durum ${pool.state} · ${pool.detail}` +
        (pool.lastScrubAt !== null
          ? ` · son scrub ${Math.round((now - pool.lastScrubAt) / 86400)} gün önce`
          : ""),
    });
  }

  // Rapor eskimesi. Sessizce eski S.M.A.R.T verisi göstermek, hiç
  // göstermemekten kötüdür: kullanıcı diskin bugün sağlıklı olduğunu sanır.
  if (report.disks.length > 0 || report.pools.some((p) => p.kind === "zfs")) {
    const staleSeconds = getNumber("hardware.report_stale_hours") * 3600;
    const age = report.reportedAt === null ? null : now - report.reportedAt;
    const stale = age === null || age > staleSeconds;

    conditions.push({
      key: "hardware:report",
      source: "system",
      severity: stale ? "warning" : "ok",
      title: stale
        ? "Donanım raporu güncellenmiyor"
        : "Donanım raporu yeniden güncelleniyor",
      detail:
        age === null
          ? "Host'taki scripts/hardware.sh hiç çalışmamış görünüyor."
          : `Son rapor ${Math.round(age / 60)} dakika önce üretildi.`,
    });
  }

  return conditions;
}

// --- Kapasite tahmini (M1.5) -----------------------------------------------

function capacityConditions(): Condition[] {
  const horizon = getNumber("alerts.capacity_forecast_days");

  return diskForecasts()
    .filter((forecast) => isActionable(forecast))
    .map((forecast) => {
      const days = forecast.daysToFull!;
      // Ufkun yarısından kısaysa kritik: "iki hafta sonra dolar" ile "yarın
      // dolar" aynı aciliyette değildir.
      const severity: Severity =
        days <= horizon / 2 ? "critical" : days <= horizon ? "warning" : "ok";

      return {
        key: `capacity:disk:${forecast.label}`,
        source: "metric" as const,
        severity,
        title:
          severity === "ok"
            ? `${forecast.label} dolma eğilimi geçti`
            : `${forecast.label} yaklaşık ${Math.round(days)} gün sonra dolabilir`,
        detail:
          `Şu an %${forecast.currentPct.toFixed(1)}, günde ${forecast.slopePerDay.toFixed(2)} puan artıyor. ` +
          `${forecast.basedOnDays} günlük veriye dayanan tahmin, uyum %${Math.round(forecast.confidence * 100)}.`,
      };
    });
}

// --- Docker (M1.6) ---------------------------------------------------------

/**
 * Restart-loop.
 *
 * Ev sunucularındaki en sinsi arıza: container "up" görünür, tabloda yeşildir,
 * ama saniyeler içinde çöküp yeniden başlamaktadır. Anlık bakış bunu göremez;
 * yeniden başlatma sayacının zaman içindeki artışı görür.
 *
 * Yalnızca DÖNGÜDE OLANLAR koşul üretir. Çalışan her container için "sorun yok"
 * koşulu üretmek `alert_state` tablosunu kalabalıklaştırır ve hiçbir şey
 * anlatmaz; döngü bitince koşul kaybolur ve motor durumu temizler.
 */
function dockerConditions(): Condition[] {
  return detectRestartLoops().map((loop) => ({
    key: `docker:restart-loop:${loop.container}`,
    source: "system" as const,
    severity: "critical" as Severity,
    title: `${loop.container} sürekli yeniden başlıyor`,
    detail: `Son ${loop.windowMinutes} dakikada ${loop.restarts} kez yeniden başladı. Container listede "çalışıyor" görünse bile hizmet vermiyor olabilir; loglara bakmak gerekir.`,
    container: loop.container,
  }));
}

// --- Güncelleme ve yedek takibi (M1.10) ------------------------------------

/**
 * İşletim sistemi güncellemeleri.
 *
 * Panel güncelleme KURMAZ; yalnızca haber verir. Varsayılan olarak sadece
 * güvenlik güncellemeleri uyarı üretir: her `apt upgrade` listesinde onlarca
 * paket bulunur ve hepsi için bildirim göndermek, iki hafta sonra susturulan
 * bir kanal demektir.
 */
async function osUpdateConditions(): Promise<Condition[]> {
  const level = getString("updates.os_alert_level");
  const report = await osUpdateReport();
  if (!report.available) return [];

  const conditions: Condition[] = [];

  if (report.stale) {
    conditions.push({
      key: "updates:os:rapor",
      source: "system",
      severity: "warning",
      title: "İşletim sistemi güncelleme raporu eskidi",
      detail: `Host'taki os-updates.sh ${getNumber("updates.report_stale_hours")} saatten uzun süredir çalışmadı. Liste eski olabilir — cron kaydı duruyor mu?`,
    });
  } else {
    conditions.push({
      key: "updates:os:rapor",
      source: "system",
      severity: "ok",
      title: "Güncelleme raporu güncel",
      detail: "os-updates.sh zamanında çalışıyor.",
    });
  }

  if (level !== "off") {
    const count = level === "security" ? report.security : report.total;
    const label = level === "security" ? "güvenlik güncellemesi" : "paket güncellemesi";

    conditions.push({
      key: "updates:os:paketler",
      source: "system",
      // Güvenlik yamaları uyarı seviyesinde: acil müdahale değil ama
      // görmezden gelinmemeli. Kritik yapmak, gerçek arızalarla aynı
      // kanaldan gürültü üretirdi.
      severity: count > 0 ? "warning" : "ok",
      title:
        count > 0
          ? `${count} ${label} bekliyor`
          : "İşletim sistemi güncel",
      detail:
        count > 0
          ? `${report.packages
              .filter((pkg) => (level === "security" ? pkg.security : true))
              .slice(0, 8)
              .map((pkg) => pkg.name)
              .join(", ")}${count > 8 ? " …" : ""}${report.rebootRequired ? "\nSunucu yeniden başlatma bekliyor." : ""}`
          : "Bekleyen güncelleme yok.",
    });
  }

  return conditions;
}

/** Yedek eskimesi — yedekleme sisteminin en sinsi arızası sessizce durmasıdır. */
async function backupConditions(): Promise<Condition[]> {
  const status = await backupStatus();
  if (!status.watching) return [];

  if (status.error) {
    return [
      {
        key: "backup:klasor",
        source: "system",
        severity: "warning",
        title: "Yedek klasörü okunamıyor",
        detail: status.error,
      },
    ];
  }

  const age = status.newestAt === null ? null : Math.floor(Date.now() / 1000) - status.newestAt;

  return [
    {
      key: "backup:eskime",
      source: "system",
      severity: status.stale ? "critical" : "ok",
      title: status.stale
        ? status.newestAt === null
          ? "Yedek klasöründe hiç yedek yok"
          : "Yedek eskidi"
        : "Yedekler güncel",
      detail:
        status.newestAt === null
          ? `${status.dir} boş. Yedekleme çalışıyor mu?`
          : `En son yedek: ${status.newestName} — ${Math.floor((age ?? 0) / 3600)} saat önce (eşik ${status.staleAfterHours} saat).`,
    },
  ];
}

/** Image güncellemeleri — varsayılan kapalı; bakım işi, arıza değil. */
function imageUpdateConditions(): Condition[] {
  if (!getBool("updates.image_alert")) return [];

  const cached = cachedImageUpdates();
  if (!cached) return [];

  const outdated = cached.value.filter((entry) => entry.updateAvailable === true);

  return [
    {
      key: "updates:images",
      source: "system",
      severity: outdated.length > 0 ? "info" : "ok",
      title:
        outdated.length > 0
          ? `${outdated.length} container için yeni image sürümü var`
          : "Tüm image'lar güncel",
      detail:
        outdated.length > 0
          ? outdated.map((entry) => `${entry.container} (${entry.image})`).join(", ")
          : "Kayıt defterindeki sürümler yereldekiyle aynı.",
    },
  ];
}

export async function evaluateConditionsAsync(): Promise<Condition[]> {
  const report = await getHardwareProvider().report();
  const [osConditions, backupConds] = await Promise.all([
    osUpdateConditions(),
    backupConditions(),
  ]);

  return [
    ...monitorConditions(),
    ...metricConditions(),
    ...hardwareConditions(report),
    ...capacityConditions(),
    ...osConditions,
    ...backupConds,
    ...imageUpdateConditions(),
    ...dockerConditions(),
  ];
}
