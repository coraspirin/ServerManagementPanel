import "server-only";

import { isMockMode } from "@/lib/env";
import { serverT } from "@/lib/i18n/runtime";
import { currentHostId, LOCAL_HOST_ID } from "@/lib/hosts/context";
import { HostError } from "@/lib/hosts/errors";
import { mockProvidersFor } from "@/lib/hosts/mock";
import { remoteProviders } from "./remote";
import { bindDockerTransport } from "@/lib/docker/transport";
import { remoteDockerMode, remoteDockerTransport } from "@/lib/docker/transport.remote";
import { getHost } from "@/lib/hosts/store";
import { liveDockerProvider } from "./docker.live";
import { mockDockerProvider } from "./docker.mock";
import { liveHardwareProvider } from "./hardware.live";
import { mockHardwareProvider } from "./hardware.mock";
import { liveMetricsProvider } from "./metrics.live";
import { mockMetricsProvider } from "./metrics.mock";
import { liveSystemProvider } from "./system.live";
import { mockSystemProvider } from "./system.mock";
import type {
  DockerProvider,
  HardwareProvider,
  MetricsProvider,
  SystemProvider,
} from "./types";

/**
 * Sağlayıcı seçimi tek yerde yapılır (T10). Çağıran taraf MOCK_MODE'u bilmez.
 *
 * Çoklu sunucu: seçim ayrıca etkin sunucuya (`currentHostId()`) göre yapılır.
 * Çağıran taraf hangi sunucuda olduğunu da bilmez — bağlamı route/job girişi
 * kurar. Yerel sunucu (etkinse) doğrudan live/mock sağlayıcıyı kullanır.
 */
export type ProviderSet = {
  system: SystemProvider;
  metrics: MetricsProvider;
  docker: DockerProvider;
  hardware: HardwareProvider;
};

/**
 * Panelin kendi makinesinin sağlayıcıları — yerel satırın etkinliğine
 * bakmaz. Yalnızca panelin KENDİSİ için (self-update: kendi container'ını
 * yerel docker.sock üzerinden günceller); kullanıcıya veri göstermek için
 * `providersFor` kullanılır.
 */
export function localProviders(): ProviderSet {
  return isMockMode()
    ? {
        system: mockSystemProvider,
        metrics: mockMetricsProvider,
        docker: mockDockerProvider,
        hardware: mockHardwareProvider,
      }
    : {
        system: liveSystemProvider,
        metrics: liveMetricsProvider,
        docker: liveDockerProvider,
        hardware: liveHardwareProvider,
      };
}

export function providersFor(hostId: number): ProviderSet {
  const host = getHost(hostId);
  // Bilinmeyen sunucu yerele DÜŞMEZ; yerel ancak etkinse kullanılır
  // (kararlar.md D1 — yerel isteğe bağlı, mount'ları olmayabilir).
  if (!host) {
    throw new HostError("unsupported", hostId, serverT("hosts.errors.unknown", { host: String(hostId) }));
  }
  if (host.isLocal || hostId === LOCAL_HOST_ID) {
    if (!host.enabled) {
      throw new HostError("unsupported", hostId, serverT("hosts.errors.disabled", { host: host.name }));
    }
    return localProviders();
  }

  if (host.agentType === "mock" && isMockMode()) {
    return mockProvidersFor(host, localProviders());
  }

  if (host.agentType === "agent") {
    if (host.status === "offline" || host.status === "incompatible") {
      throw new HostError(host.status, hostId, serverT(`hosts.errors.${host.status}`));
    }
    const remote = remoteProviders(host);
    // Ham Engine API tüneli (K2): şekillendirme merkezde, aynı live sağlayıcı
    // ajanın `docker.api`'sine bağlanır. Yoksa ajandaki sağlayıcı (RPC).
    if (remoteDockerMode(host) === "api") {
      return { ...remote, docker: bindDockerTransport(liveDockerProvider, remoteDockerTransport(host)) };
    }
    return remote;
  }

  throw new HostError("unsupported", hostId, serverT("hosts.errors.unsupported"));
}

export function getSystemProvider(): SystemProvider {
  return providersFor(currentHostId()).system;
}

export function getMetricsProvider(): MetricsProvider {
  return providersFor(currentHostId()).metrics;
}

export function getDockerProvider(): DockerProvider {
  return providersFor(currentHostId()).docker;
}

export function getHardwareProvider(): HardwareProvider {
  return providersFor(currentHostId()).hardware;
}

export type * from "./types";
