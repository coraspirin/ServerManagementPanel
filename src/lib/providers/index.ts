import "server-only";

import { isMockMode } from "@/lib/env";
import { serverT } from "@/lib/i18n/runtime";
import { currentHostId, LOCAL_HOST_ID } from "@/lib/hosts/context";
import { HostError } from "@/lib/hosts/errors";
import { mockProvidersFor } from "@/lib/hosts/mock";
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
 * kurar. Yerel sunucu eskisi gibi doğrudan live/mock sağlayıcıyı kullanır.
 */
export type ProviderSet = {
  system: SystemProvider;
  metrics: MetricsProvider;
  docker: DockerProvider;
  hardware: HardwareProvider;
};

function localProviders(): ProviderSet {
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
  if (hostId === LOCAL_HOST_ID) return localProviders();

  const host = getHost(hostId);
  if (!host || host.isLocal) return localProviders();

  if (host.agentType === "mock" && isMockMode()) {
    return mockProvidersFor(host, localProviders());
  }

  // Uzak (ajan) sağlayıcıları bir sonraki fazda bağlanıyor.
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
