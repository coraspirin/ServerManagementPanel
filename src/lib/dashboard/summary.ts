import "server-only";

import { unacknowledgedCount } from "@/lib/alerts/store";
import { getDb } from "@/lib/db/client";
import { currentHostId, runWithHost } from "@/lib/hosts/context";
import { listHosts } from "@/lib/hosts/store";
import type { HostStatus } from "@/lib/hosts/types";
import { latestSnapshot } from "@/lib/metrics/collect";
import { getDockerProvider } from "@/lib/providers";
import { getNumber } from "@/lib/settings";

/**
 * Gösterge paneli özetleri.
 *
 * Mümkün olan her şey VERİTABANINDAN okunuyor: metrik toplayıcı her sunucunun
 * son değerlerini (container ölçümleri dahil) zaten `metrics_raw`a yazıyor.
 * Uzak sunucuya canlı istek atmak yalnızca container durumu için gerekiyor ve
 * o da süre sınırlı — çevrimdışı bir ajan ana sayfayı bekletmemeli.
 */

const DOCKER_TIMEOUT_MS = 4_000;

/** Etiketli bir metriğin her etiket için en yeni değeri (seçili sunucu). */
function latestLabelled(metric: string): Map<string, number> {
  const window = Math.max(getNumber("monitoring.collect_interval") * 4, 120);
  const since = Math.floor(Date.now() / 1000) - window;
  const rows = getDb()
    .prepare(
      `SELECT label, value FROM metrics_raw
       WHERE host_id = ? AND metric = ? AND ts >= ? ORDER BY ts ASC`,
    )
    .all(currentHostId(), metric, since) as { label: string; value: number }[];
  // Sıra artan: son yazan kazanır.
  return new Map(rows.map((row) => [row.label, row.value]));
}

export type ContainerConsumer = { name: string; cpuPct: number; memUsed: number };

export type ContainerOverview = {
  /** Container listesi alınabildi mi (Docker erişilemiyorsa false). */
  available: boolean;
  total: number;
  running: number;
  stopped: number;
  /** Sağlık kontrolü "unhealthy" ya da yeniden başlama döngüsünde olanlar. */
  troubled: { name: string; reason: "unhealthy" | "restarting" }[];
  top: ContainerConsumer[];
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export async function containerOverview(): Promise<ContainerOverview> {
  const cpu = latestLabelled("docker.cpu_pct");
  const mem = latestLabelled("docker.mem_used");
  const top = [...cpu.entries()]
    .map(([name, cpuPct]) => ({ name, cpuPct, memUsed: mem.get(name) ?? 0 }))
    .sort((a, b) => b.cpuPct - a.cpuPct || b.memUsed - a.memUsed)
    .slice(0, 5);

  try {
    const list = await withTimeout(getDockerProvider().list(true), DOCKER_TIMEOUT_MS);
    const running = list.filter((c) => c.state === "running").length;
    const troubled = list.flatMap((c): ContainerOverview["troubled"] =>
      c.state === "restarting"
        ? [{ name: c.name, reason: "restarting" }]
        : c.health === "unhealthy"
          ? [{ name: c.name, reason: "unhealthy" }]
          : [],
    );
    return {
      available: true,
      total: list.length,
      running,
      stopped: list.length - running,
      troubled,
      top,
    };
  } catch {
    return { available: false, total: 0, running: 0, stopped: 0, troubled: [], top };
  }
}

export type FleetEntry = {
  id: number;
  name: string;
  status: HostStatus;
  isLocal: boolean;
  lastSeen: number | null;
  latencyMs: number | null;
  cpuPct: number | null;
  memUsedPct: number | null;
  /** En dolu diskin doluluğu. */
  diskPct: number | null;
  /** Okunmamış uyarı/kritik olay. */
  pending: number;
};

/**
 * Tüm etkin sunucuların özeti; tek sunuculu kurulumda boş liste.
 *
 * `activeHosts()` değil: o çevrimdışı sunucuları eliyor, oysa bu kartın asıl
 * söylemesi gereken şey tam olarak hangisinin düştüğü.
 */
export function fleetOverview(): FleetEntry[] {
  const hosts = listHosts().filter((host) => host.enabled);
  if (hosts.length < 2) return [];

  return hosts.map((host) => {
    const snapshot = runWithHost(host.id, () => latestSnapshot());
    const diskPct = snapshot.disks.reduce<number | null>(
      (worst, disk) => (worst === null || disk.usedPct > worst ? disk.usedPct : worst),
      null,
    );
    return {
      id: host.id,
      name: host.name,
      // Yerel sunucunun heartbeat'i yok; panel çalışıyorsa o da ayakta.
      status: host.isLocal ? "online" : host.status,
      isLocal: host.isLocal,
      lastSeen: host.lastSeen,
      latencyMs: host.latencyMs,
      cpuPct: snapshot.cpuPct,
      memUsedPct: snapshot.memUsedPct,
      diskPct,
      pending: unacknowledgedCount(host.id),
    };
  });
}
