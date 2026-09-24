import "server-only";

import { getDb } from "@/lib/db/client";
import { isMockMode } from "@/lib/env";
import type {
  DockerProvider,
  HardwareProvider,
  MetricSample,
  MetricsProvider,
  SystemProvider,
} from "@/lib/providers/types";
import { HostError } from "./errors";
import type { Host } from "./types";

/**
 * MOCK_MODE'da çoklu sunucu (T10'un devamı).
 *
 *   MOCK_HOSTS=3            → local + mock-2 + mock-3
 *   MOCK_OFFLINE_HOSTS=3    → mock-3 çevrimdışı görünür
 *
 * Sahte sunucular gerçek ajan olmadan seçiciyi, sunucu bazlı işleri ve
 * çevrimdışı durumunu Windows'ta sınamaya yarar. Her sunucunun değerleri
 * kimliğinden türeyen sabit bir çarpanla ölçeklenir: sunucu değiştirince
 * ekranın gerçekten değiştiği görülebilsin.
 */

const MAX_MOCK_HOSTS = 20;

export function mockHostCount(): number {
  const raw = Number(process.env.MOCK_HOSTS ?? "1");
  if (!Number.isInteger(raw) || raw < 1) return 1;
  return Math.min(raw, MAX_MOCK_HOSTS);
}

function offlineIds(): Set<number> {
  return new Set(
    (process.env.MOCK_OFFLINE_HOSTS ?? "")
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((id) => Number.isInteger(id) && id > 1),
  );
}

/** Açılışta: sahte sunucu satırlarını oluşturur ve durumlarını tazeler. */
export function seedMockHosts(): string | null {
  if (!isMockMode()) return null;
  const count = mockHostCount();
  const offline = offlineIds();
  const db = getDb();

  const upsert = db.prepare(
    `INSERT INTO hosts (id, name, agent_type, is_local, status, hostname, os_name, sort_order)
     VALUES (?, ?, 'mock', 0, ?, ?, 'Debian GNU/Linux 12 (bookworm)', ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, enabled = 1
     WHERE hosts.agent_type = 'mock'`,
  );
  for (let id = 2; id <= count; id++) {
    upsert.run(id, `mock-${id}`, offline.has(id) ? "offline" : "online", `mock-${id}`, id);
  }
  // Sayı azaltıldıysa fazlası devre dışı kalır (silinmez: geçmişi dursun).
  db.prepare("UPDATE hosts SET enabled = 0 WHERE agent_type = 'mock' AND id > ?").run(count);

  return count > 1 ? `${count - 1} sahte sunucu hazır (MOCK_HOSTS=${count})` : null; // i18n-ignore — operatör logu
}

/** Sunucuya özgü sabit çarpan: 1 → 1.0, diğerleri 0.55 … 1.3 arası. */
export function mockFactor(hostId: number): number {
  if (hostId === 1) return 1;
  return 0.55 + ((hostId * 37) % 76) / 100;
}

/**
 * Yalnızca oran ve yük metrikleri ölçeklenir; toplam bellek/disk boyutları
 * aynı kalır (yoksa "kullanılan > toplam" gibi tutarsızlıklar çıkardı).
 */
export function scaleSample(sample: MetricSample, hostId: number): MetricSample {
  const factor = mockFactor(hostId);
  if (factor === 1) return sample;
  if (sample.metric.endsWith("pct")) {
    return { ...sample, value: Math.min(99.5, sample.value * factor) };
  }
  if (sample.metric.startsWith("load.") || sample.metric.startsWith("net.")) {
    return { ...sample, value: sample.value * factor };
  }
  return sample;
}

export type MockProviderSet = {
  system: SystemProvider;
  metrics: MetricsProvider;
  docker: DockerProvider;
  hardware: HardwareProvider;
};

/**
 * Yerel sahte sağlayıcıları sunucuya göre sarar. Çevrimdışı işaretli
 * sunucuda her çağrı `HostError("offline")` fırlatır — gerçek ajanın
 * zaman aşımıyla aynı yoldan geçsin.
 */
export function mockProvidersFor(host: Host, base: MockProviderSet): MockProviderSet {
  const guard = () => {
    if (host.status === "offline") throw new HostError("offline", host.id);
  };

  const docker = new Proxy(base.docker, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        guard();
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });

  return {
    system: {
      async info() {
        guard();
        const info = await base.system.info();
        return { ...info, hostname: host.hostname ?? host.name };
      },
    },
    metrics: {
      async sample() {
        guard();
        return (await base.metrics.sample()).map((sample) => scaleSample(sample, host.id));
      },
    },
    docker,
    hardware: {
      async report() {
        guard();
        return base.hardware.report();
      },
    },
  };
}

/** Geçmiş üretilecek sunucular: yerel + etkin sahte sunucular. */
export function mockHistoryHostIds(): number[] {
  const rows = getDb()
    .prepare("SELECT id FROM hosts WHERE is_local = 1 OR (agent_type = 'mock' AND enabled = 1)")
    .all() as { id: number }[];
  return rows.map((row) => row.id);
}
