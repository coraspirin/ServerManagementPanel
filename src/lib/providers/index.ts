import "server-only";

import { isMockMode } from "@/lib/env";
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
 */
export function getSystemProvider(): SystemProvider {
  return isMockMode() ? mockSystemProvider : liveSystemProvider;
}

export function getMetricsProvider(): MetricsProvider {
  return isMockMode() ? mockMetricsProvider : liveMetricsProvider;
}

export function getDockerProvider(): DockerProvider {
  return isMockMode() ? mockDockerProvider : liveDockerProvider;
}

export function getHardwareProvider(): HardwareProvider {
  return isMockMode() ? mockHardwareProvider : liveHardwareProvider;
}

export type * from "./types";
