import type { ContainerView } from "@/lib/docker/types";
import type { AppCard } from "@/lib/apps/types";
import type { EventRow } from "@/lib/alerts/types";
import type { Bookmark } from "@/lib/home/bookmarks";
import type { MaintenanceWindow, MonitorView } from "@/lib/monitors/types";
import type { Snapshot } from "@/lib/metrics/catalog";
import type { HardwareReport, SystemInfo } from "@/lib/providers/types";
import { LOCAL_HOST_ID } from "../hosts/context.ts";

/**
 * T12 — iç görünüm modelleri → KARARLI v1 şekilleri.
 *
 * Ayrı `/api/v1` ad alanının tek gerekçesi bu dosya. İç uçların yanıtları
 * ekranların ihtiyacına göre yazıldı ve ekranla birlikte değişiyor; onları
 * doğrudan dışarı vermek, bir UI değişikliğinin dış istemcileri kırması
 * demekti. Buradaki haritalama o iki dünyayı ayırıyor.
 *
 * ⚠️ İKİ KURAL:
 *
 * 1. Tipler ELLE yazılır — iç tiplerden `Pick<>`/`Omit<>` ile TÜRETİLMEZ.
 *    Türetilmiş bir tip, iç model değiştiğinde sözleşmeyi sessizce değiştirir
 *    ve `tsc` bunu hata olarak göremez. Elle yazılan tip, iç modelde bir alan
 *    kaybolduğunda derleme hatası verir — istenen tam olarak budur.
 *
 * 2. v1 route'ları ASLA iç nesneyi doğrudan `Response.json`'a vermez. Bu
 *    dosyadan geçmeyen bir alan, dışarı çıkmamalıdır.
 *
 * `hostId` her kaynak şeklinde BUGÜNDEN var (T7). Bugün hepsi 1 dönüyor.
 * Alanı sonradan eklemek kırıcı değil ama ANLAMINI sonradan değiştirmek —
 * "bu liste artık tüm host'ları kapsıyor" — kırıcı olur ve v2 gerektirirdi.
 */

/**
 * Merkezi kaynaklar (izleyici, olay, uygulama, yer imi, bakım penceresi)
 * panelin kendi sunucusuna ait sayılır. Sunucu bazlı kaynakların
 * serileştiricileri `hostId`'yi parametre olarak alır.
 */
const HOST_ID = LOCAL_HOST_ID;

// --- Sistem ---------------------------------------------------------------

export type V1System = {
  hostId: number;
  hostname: string;
  platform: string;
  kernel: string;
  osName: string | null;
  arch: string;
  cpuModel: string;
  cpuCount: number;
  totalMemoryBytes: number;
  uptimeSeconds: number;
  metrics: {
    measuredAt: number | null;
    cpuPercent: number | null;
    cpuIowaitPercent: number | null;
    memoryUsedPercent: number | null;
    memoryUsedBytes: number | null;
    memoryTotalBytes: number | null;
    swapUsedPercent: number | null;
    load1: number | null;
    load5: number | null;
    load15: number | null;
    disks: { mount: string; usedPercent: number; usedBytes: number; freeBytes: number; totalBytes: number }[];
    interfaces: { name: string; rxBytesPerSecond: number; txBytesPerSecond: number }[];
  };
};

export function serializeSystem(
  info: SystemInfo,
  snapshot: Snapshot,
  hostId: number = LOCAL_HOST_ID,
): V1System {
  return {
    hostId,
    hostname: info.hostname,
    platform: info.platform,
    // İç ad `release`; dışarıda `kernel` çünkü değerin ne olduğunu söylüyor.
    kernel: info.release,
    osName: info.osName,
    arch: info.arch,
    cpuModel: info.cpuModel,
    cpuCount: info.cpuCount,
    totalMemoryBytes: info.totalMemBytes,
    uptimeSeconds: info.uptimeSeconds,
    metrics: {
      measuredAt: snapshot.ts,
      cpuPercent: snapshot.cpuPct,
      cpuIowaitPercent: snapshot.cpuIowaitPct,
      memoryUsedPercent: snapshot.memUsedPct,
      memoryUsedBytes: snapshot.memUsed,
      memoryTotalBytes: snapshot.memTotal,
      swapUsedPercent: snapshot.swapUsedPct,
      load1: snapshot.load1,
      load5: snapshot.load5,
      load15: snapshot.load15,
      disks: snapshot.disks.map((disk) => ({
        mount: disk.mount,
        usedPercent: disk.usedPct,
        usedBytes: disk.used,
        freeBytes: disk.free,
        totalBytes: disk.total,
      })),
      interfaces: snapshot.interfaces.map((item) => ({
        name: item.name,
        rxBytesPerSecond: item.rxBps,
        txBytesPerSecond: item.txBps,
      })),
    },
  };
}

// --- Donanım --------------------------------------------------------------

export type V1Hardware = {
  hostId: number;
  reportedAt: number | null;
  virtualization: string | null;
  /** Verinin neden eksik olduğu. Boş bir panel "arıza mı, yok mu" sorusunu cevapsız bırakır. */
  notes: string[];
  temperatures: { id: string; source: string; label: string; celsius: number; highCelsius: number | null; criticalCelsius: number | null }[];
  disks: {
    device: string;
    model: string;
    serial: string | null;
    sizeBytes: number | null;
    health: string;
    temperatureCelsius: number | null;
    powerOnHours: number | null;
    reallocatedSectors: number | null;
    pendingSectors: number | null;
    uncorrectableErrors: number | null;
    percentageUsed: number | null;
  }[];
  pools: { name: string; kind: string; state: string; healthy: boolean; detail: string; lastScrubAt: number | null; scrubResult: string | null }[];
};

export function serializeHardware(report: HardwareReport, hostId: number = LOCAL_HOST_ID): V1Hardware {
  return {
    hostId,
    reportedAt: report.reportedAt,
    virtualization: report.virtualization,
    notes: report.notes,
    temperatures: report.temperatures.map((entry) => ({
      id: entry.id,
      source: entry.source,
      label: entry.label,
      celsius: entry.celsius,
      highCelsius: entry.highC,
      criticalCelsius: entry.criticalC,
    })),
    disks: report.disks.map((disk) => ({
      device: disk.device,
      model: disk.model,
      serial: disk.serial,
      sizeBytes: disk.sizeBytes,
      health: disk.health,
      temperatureCelsius: disk.temperatureC,
      powerOnHours: disk.powerOnHours,
      reallocatedSectors: disk.reallocatedSectors,
      pendingSectors: disk.pendingSectors,
      uncorrectableErrors: disk.uncorrectableErrors,
      percentageUsed: disk.percentageUsed,
    })),
    pools: report.pools.map((pool) => ({
      name: pool.name,
      kind: pool.kind,
      state: pool.state,
      healthy: pool.healthy,
      detail: pool.detail,
      lastScrubAt: pool.lastScrubAt,
      scrubResult: pool.scrubResult,
    })),
  };
}

// --- Container ------------------------------------------------------------

export type V1Container = {
  hostId: number;
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  health: string | null;
  createdAt: number;
  ports: { hostIp: string | null; hostPort: number | null; containerPort: number; protocol: string }[];
  compose: { project: string | null; service: string | null };
  metrics: {
    cpuPercent: number | null;
    memoryUsedBytes: number | null;
    memoryPercent: number | null;
    restartCount: number | null;
    restartsInWindow: number | null;
    restartWindowMinutes: number;
  };
};

/**
 * `labels` ve `networks` BİLEREK dışarı verilmiyor.
 *
 * İkisi de iç ihtiyaç için taşınıyor (kart keşfi, yayınlama ekranının ağ
 * kontrolü) ve etiketler üçüncü taraf imajların koyduğu her şeyi içeriyor —
 * bazen ortam bilgisi, bazen yol. Sözleşmeye girmeleri, ileride
 * daraltılamayacak bir yüzey açardı. Gerçekten gerekirse eklemek serbest;
 * çıkarmak değil.
 */
export function serializeContainer(view: ContainerView, hostId: number = LOCAL_HOST_ID): V1Container {
  return {
    hostId,
    id: view.id,
    name: view.name,
    image: view.image,
    state: view.state,
    status: view.status,
    health: view.health,
    createdAt: view.createdAt,
    ports: view.ports.map((port) => ({
      hostIp: port.hostIp,
      hostPort: port.hostPort,
      containerPort: port.containerPort,
      protocol: port.protocol,
    })),
    compose: { project: view.composeProject, service: view.composeService },
    metrics: {
      cpuPercent: view.cpuPct,
      memoryUsedBytes: view.memUsed,
      memoryPercent: view.memPct,
      restartCount: view.restartCount,
      restartsInWindow: view.restartsInWindow,
      restartWindowMinutes: view.restartLoopWindowMinutes,
    },
  };
}

// --- Monitör --------------------------------------------------------------

export type V1Monitor = {
  hostId: number;
  id: number;
  name: string;
  type: string;
  target: string;
  enabled: boolean;
  status: string;
  inMaintenance: boolean;
  lastCheckAt: number | null;
  lastChangeAt: number | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  nextCheckAt: number | null;
  consecutiveFailures: number;
  uptime24hPercent: number | null;
  uptime30dPercent: number | null;
  intervalSeconds: number;
  timeoutSeconds: number;
};

/**
 * `days` (60 günlük şerit) dışarı verilmiyor: monitör başına 60 nesne, liste
 * ucunu on katına çıkarırdı ve bir script'in ihtiyacı olan şey monitörün ŞU
 * ANKİ durumu. Geçmiş isteyen `/api/v1/events`e bakar.
 */
export function serializeMonitor(view: MonitorView): V1Monitor {
  return {
    hostId: HOST_ID,
    id: view.id,
    name: view.name,
    type: view.type,
    target: view.target,
    enabled: view.enabled,
    status: view.status,
    inMaintenance: view.inMaintenance,
    lastCheckAt: view.lastCheckAt,
    lastChangeAt: view.lastChangeAt,
    lastLatencyMs: view.lastLatencyMs,
    lastError: view.lastError,
    nextCheckAt: view.nextCheckAt,
    consecutiveFailures: view.consecutiveFails,
    uptime24hPercent: view.uptime24h,
    uptime30dPercent: view.uptime30d,
    // Çözümlenmiş değerler: istemci "null = varsayılan" kuralını bilmek
    // zorunda kalmasın.
    intervalSeconds: view.effective.intervalSeconds,
    timeoutSeconds: view.effective.timeoutSeconds,
  };
}

// --- Olay -----------------------------------------------------------------

export type V1Event = {
  hostId: number;
  id: number;
  ts: number;
  severity: string;
  source: string;
  alertKey: string;
  title: string;
  detail: string;
  notifiedChannels: string[];
  suppressedReason: string | null;
  acknowledgedAt: number | null;
  acknowledgedBy: string | null;
};

export function serializeEvent(row: EventRow): V1Event {
  return {
    hostId: HOST_ID,
    id: row.id,
    ts: row.ts,
    severity: row.severity,
    source: row.source,
    alertKey: row.alertKey,
    title: row.title,
    detail: row.detail,
    notifiedChannels: row.notifiedChannels,
    suppressedReason: row.suppressedReason,
    acknowledgedAt: row.acknowledgedAt,
    acknowledgedBy: row.acknowledgedBy,
  };
}

// --- Uygulama kartı -------------------------------------------------------

export type V1App = {
  hostId: number;
  id: number;
  name: string;
  description: string;
  url: string;
  categoryId: number | null;
  containerName: string;
  monitorId: number | null;
  source: string;
  enabled: boolean;
  sortOrder: number;
};

/**
 * `widgetConfigured`, `internalUrl`, `icon`, `color` dışarıda.
 *
 * `internalUrl` panelin kendi ağından çözülen adres — dış bir istemci için
 * ulaşılamaz olabilir ve "çalışmayan adres" olarak görünürdü. Diğer üçü saf
 * sunum bilgisi.
 */
export function serializeApp(card: AppCard): V1App {
  return {
    hostId: HOST_ID,
    id: card.id,
    name: card.name,
    description: card.description,
    url: card.url,
    categoryId: card.categoryId,
    containerName: card.containerName,
    monitorId: card.monitorId,
    source: card.source,
    enabled: card.enabled,
    sortOrder: card.sortOrder,
  };
}

// --- Bookmark -------------------------------------------------------------

export type V1Bookmark = {
  hostId: number;
  id: number;
  group: string;
  title: string;
  url: string;
  sortOrder: number;
};

/**
 * İç uç grupları HAZIR KURULMUŞ döndürüyor (`bookmarkGroups()`), v1 düz liste
 * veriyor.
 *
 * Sebep: grup bir bookmark alanı, ayrı bir kaynak değil. Gruplanmış biçim
 * ekranın istediği şekil ve gruplama kuralı değişirse (boş grupların
 * gizlenmesi, sıralama) sözleşme kırılırdı. Düz liste + `group` alanı, aynı
 * bilgiyi istemcinin kendi istediği gibi toplamasına bırakıyor.
 */
export function serializeBookmark(bookmark: Bookmark): V1Bookmark {
  return {
    hostId: HOST_ID,
    id: bookmark.id,
    group: bookmark.group,
    title: bookmark.title,
    url: bookmark.url,
    sortOrder: bookmark.sortOrder,
  };
}

// --- Bakım penceresi ------------------------------------------------------

export type V1Maintenance = {
  hostId: number;
  id: number;
  name: string;
  kind: string;
  startsAt: number | null;
  endsAt: number | null;
  /** 0 = Pazar. `kind: "weekly"` dışında her zaman boş. */
  weekdays: number[];
  /** Gün içi dakika (0-1439). */
  startMinute: number | null;
  endMinute: number | null;
  /** null = tüm monitörler. */
  monitorId: number | null;
  enabled: boolean;
  /** Pencere ŞU AN yürürlükte mi — sunucuda hesaplanır. */
  active: boolean;
};

/**
 * `active` dışarı VERİLİYOR, türetilmiş bir alan olmasına rağmen.
 *
 * Diğer türetilmiş alanlar (`days` şeridi gibi) dışarıda tutuldu çünkü
 * istemci onları kendi hesaplayabilirdi. Bu öyle değil: "pencere şu an aktif
 * mi" sorusunun cevabı sunucunun saat dilimine bağlı ve istemcinin `weekdays`
 * + `startMinute` üçlüsünden yeniden hesaplaması, panelin hangi saat diliminde
 * çalıştığını bilmesini gerektirirdi. Yanlış hesaplanan bir "aktif" değeri,
 * bir otomasyonun bakım sırasında alarm üretmesi demek.
 */
export function serializeMaintenance(window: MaintenanceWindow): V1Maintenance {
  return {
    hostId: HOST_ID,
    id: window.id,
    name: window.name,
    kind: window.kind,
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    weekdays: window.weekdays,
    startMinute: window.startMinute,
    endMinute: window.endMinute,
    monitorId: window.monitorId,
    enabled: window.enabled,
    active: window.active,
  };
}
