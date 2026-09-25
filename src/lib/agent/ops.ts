import "server-only";

import { existsSync } from "node:fs";
import {
  AGENT_EXEC_USER,
  agentSession,
  closeSession,
  resizeSession,
  startSession,
  streamAgentSession,
  writeInput,
  type StartExecOptions,
} from "@/lib/docker/exec";
import { dockerEventStream } from "@/lib/docker/events";
import { appVersion } from "@/lib/env";
import { helperConfigured } from "@/lib/host/helper";
import {
  getDockerProvider,
  getHardwareProvider,
  getMetricsProvider,
  getSystemProvider,
  type DockerProvider,
} from "@/lib/providers";
import { AGENT_PROTOCOL, DOCKER_CALLS, DOCKER_STREAMS, type AgentHello } from "./protocol";

/**
 * Ajanın ağdan çalıştırmaya izin verdiği işlemler — KAPALI liste.
 *
 * Ad ağdan geliyor; dinamik modül ya da metot araması YOK, yalnızca burada
 * açıkça yazılanlar. Listede olmayan her ad 404. Ajan yalnızca G/Ç yapar:
 * veritabanı, sırlar ve iş mantığı merkezde kalır.
 */

export type CallOp = { kind: "call"; run: (args: unknown[], signal: AbortSignal) => Promise<unknown> };
export type StreamOp = {
  kind: "stream";
  run: (args: unknown[], signal: AbortSignal) => AsyncGenerator<unknown>;
};
export type AgentOp = CallOp | StreamOp;

export async function agentHello(): Promise<AgentHello> {
  const info = await getSystemProvider().info();
  // turbopackIgnore: yollar çalışma zamanında env'den geliyor; işaretsiz
  // bırakılırsa Turbopack tüm projeyi imaja izler (NFT uyarısı).
  return {
    protocol: AGENT_PROTOCOL,
    version: appVersion(),
    hostname: info.hostname,
    osName: info.osName,
    time: Math.floor(Date.now() / 1000),
    capabilities: {
      docker: existsSync(/*turbopackIgnore: true*/ process.env.DOCKER_SOCKET ?? "/var/run/docker.sock"),
      helper: helperConfigured(),
      hostRoot: existsSync(/*turbopackIgnore: true*/ process.env.HOST_ROOT ?? "/host/root"),
      reports: existsSync(/*turbopackIgnore: true*/ process.env.REPORTS_DIR ?? "/app/reports"),
    },
  };
}

function dockerCall(method: (typeof DOCKER_CALLS)[number]): CallOp {
  return {
    kind: "call",
    run: (args) => {
      const docker = getDockerProvider();
      return (docker[method] as (...a: unknown[]) => Promise<unknown>).apply(docker, args);
    },
  };
}

// Ad listesi protokolde; burada gerçekten DockerProvider metodu olduklarını
// derleyici doğrular.
const _dockerNames: readonly (keyof DockerProvider)[] = [...DOCKER_CALLS, ...DOCKER_STREAMS];
void _dockerNames;

export const AGENT_OPS: Record<string, AgentOp> = {
  "agent.hello": { kind: "call", run: () => agentHello() },
  "system.info": { kind: "call", run: () => getSystemProvider().info() },
  "metrics.sample": { kind: "call", run: () => getMetricsProvider().sample() },
  "hardware.report": { kind: "call", run: () => getHardwareProvider().report() },
  ...Object.fromEntries(DOCKER_CALLS.map((method) => [`docker.${method}`, dockerCall(method)])),
  "docker.pullImage": {
    kind: "stream",
    run: (args) => getDockerProvider().pullImage(String(args[0])),
  },
  "docker.logs": {
    kind: "stream",
    // AbortSignal ağdan taşınamaz: merkezin gönderdiği seçeneklerdeki sinyal
    // yerine bu isteğin kendi sinyali konur — merkez bağlantıyı kapatınca
    // Docker log akışı da kapanır.
    run: (args, signal) => {
      const options = (args[1] ?? {}) as Parameters<DockerProvider["logs"]>[1];
      return getDockerProvider().logs(String(args[0]), { ...options, signal });
    },
  },
  "docker.events": {
    kind: "stream",
    run: (args, signal) => dockerEventStream(Number(args[0]) || 0, signal),
  },
  // Container terminali: oturum merkezde kullanıcıya bağlı; burada yalnızca
  // exec'in kendisi. Kabuk ve kullanıcı merkezde izin listesinden geçti.
  "exec.start": {
    kind: "call",
    run: async (args) => {
      const options = (args[0] ?? {}) as Omit<StartExecOptions, "username">;
      const session = await startSession({ ...options, username: AGENT_EXEC_USER });
      return { id: session.id };
    },
  },
  "exec.output": {
    kind: "stream",
    run: (args, signal) => streamAgentSession(String(args[0]), signal),
  },
  "exec.input": {
    kind: "call",
    run: async (args) => writeInput(agentSession(String(args[0])), String(args[1] ?? "")),
  },
  "exec.resize": {
    kind: "call",
    run: async (args) => {
      agentSession(String(args[0]));
      await resizeSession(String(args[0]), Number(args[1]), Number(args[2]));
    },
  },
  "exec.close": {
    kind: "call",
    run: async (args) => {
      closeSession(String(args[0]));
    },
  },
};
