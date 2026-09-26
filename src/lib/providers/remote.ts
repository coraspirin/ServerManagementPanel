import "server-only";

import { agentCall, agentStream } from "@/lib/agent/client";
import { DOCKER_CALLS, DOCKER_STREAMS } from "@/lib/agent/protocol";
import type { Host } from "@/lib/hosts/types";
import type {
  DockerProvider,
  HardwareProvider,
  MetricsProvider,
  SystemProvider,
} from "./types";

/**
 * Uzak sunucu (panel-agent) sağlayıcıları. Arayüzler yerel olanlarla aynı;
 * her çağrı ajandaki aynı adlı yerel sağlayıcıya imzalı RPC olarak gider.
 * Çağıran taraf farkı bilmez.
 */

const CALLS = new Set<string>(DOCKER_CALLS);
const STREAMS = new Set<string>(DOCKER_STREAMS);

function remoteDocker(host: Host): DockerProvider {
  return new Proxy({} as DockerProvider, {
    get(_target, property) {
      if (typeof property !== "string") return undefined;

      if (property === "logs") {
        // AbortSignal ağdan taşınamaz: seçeneklerden çıkarılıp bağlantının
        // kendisine bağlanıyor, ajan kendi tarafında yeniden kuruyor.
        return (id: string, options: Parameters<DockerProvider["logs"]>[1]) => {
          const { signal, ...rest } = options;
          return agentStream(host, "docker.logs", [id, rest], signal);
        };
      }
      if (STREAMS.has(property)) {
        return (...args: unknown[]) => agentStream(host, `docker.${property}`, args);
      }
      if (property === "runThrowaway") {
        // Geçici container'ın kendi süre sınırı var (restic yedeği saatler
        // sürebilir); RPC ondan önce kopmasın.
        return (options: Parameters<DockerProvider["runThrowaway"]>[0]) =>
          agentCall(host, "docker.runThrowaway", [options], {
            timeoutMs: Math.max(60 * 60_000, (options.timeoutMs ?? 0) + 60_000),
          });
      }
      if (CALLS.has(property)) {
        return (...args: unknown[]) => agentCall(host, `docker.${property}`, args);
      }
      return undefined;
    },
  });
}

export function remoteProviders(host: Host): {
  system: SystemProvider;
  metrics: MetricsProvider;
  docker: DockerProvider;
  hardware: HardwareProvider;
} {
  return {
    system: { info: () => agentCall(host, "system.info") },
    metrics: { sample: () => agentCall(host, "metrics.sample") },
    hardware: { report: () => agentCall(host, "hardware.report") },
    docker: remoteDocker(host),
  };
}
