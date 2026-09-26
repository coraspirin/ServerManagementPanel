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
import { scanWatchDir } from "@/lib/backup/watch";
import {
  downloadFrames,
  localAnalyzeUsage,
  localListDirectory,
  localReadTextFile,
} from "@/lib/files/browse";
import { localRunCleanup, localScanCleanup } from "@/lib/files/cleanup";
import {
  localListTables,
  localReadTable,
  localRunQuery,
  localTableStructure,
  localTestConnection,
} from "@/lib/dbadmin";
import type { ConnectionSecrets } from "@/lib/dbadmin/store";
import {
  localChangeMode,
  localCreateDirectory,
  localRemoveEntry,
  localRenameEntry,
  localWriteFile,
} from "@/lib/files/write";
import { localHostDirExists, localListHostDirs } from "@/lib/host/dirs";
import { ownImage } from "@/lib/host/self";
import { localHostAccounts } from "@/lib/host/users";
import { localOsUpdateReport } from "@/lib/updates/os";

import { appVersion } from "@/lib/env";
import { serverT } from "@/lib/i18n/runtime";
import {
  callLocalHelper,
  helperConfigured,
  remoteHelperAllowed,
  type HelperAction,
} from "@/lib/host/helper";
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
  "agent.image": { kind: "call", run: () => ownImage() },
  // Sunucunun kendi dosyaları (bkz. hosts/on-host.ts): merkez aynı işin
  // yerel sürümünü burada çağırtır.
  "host.accounts": { kind: "call", run: () => localHostAccounts() },
  "host.listDirs": { kind: "call", run: (args) => localListHostDirs(String(args[0] ?? "/")) },
  "host.dirExists": { kind: "call", run: (args) => localHostDirExists(String(args[0] ?? "/")) },
  "updates.osReport": { kind: "call", run: () => localOsUpdateReport() },
  "backup.scanDir": { kind: "call", run: (args) => scanWatchDir(String(args[0] ?? "")) },
  // Dosya yöneticisi: yol denetimi (izinli kökler, gizli dosyalar) ajanda da
  // aynı `checkPath` ile yapılır; kökler merkezin gönderdiği ayar katmanından.
  "files.list": { kind: "call", run: (args) => localListDirectory(String(args[0] ?? "/")) },
  "files.read": { kind: "call", run: (args) => localReadTextFile(String(args[0] ?? "")) },
  "files.usage": { kind: "call", run: (args) => localAnalyzeUsage(String(args[0] ?? "")) },
  "files.download": { kind: "stream", run: (args, signal) => downloadFrames(String(args[0] ?? ""), signal) },
  "files.mkdir": { kind: "call", run: (args) => localCreateDirectory(String(args[0] ?? "")) },
  "files.remove": {
    kind: "call",
    run: (args) => localRemoveEntry(String(args[0] ?? ""), args[1] === true),
  },
  "files.rename": {
    kind: "call",
    run: (args) => localRenameEntry(String(args[0] ?? ""), String(args[1] ?? "")),
  },
  "files.chmod": {
    kind: "call",
    run: (args) => localChangeMode(String(args[0] ?? ""), String(args[1] ?? "")),
  },
  "files.write": {
    kind: "call",
    run: (args) => {
      if (!Buffer.isBuffer(args[1])) throw new Error(serverT("api.invalidRequest"));
      return localWriteFile(String(args[0] ?? ""), args[1]);
    },
  },
  "files.cleanupScan": { kind: "call", run: () => localScanCleanup() },
  "files.cleanupRun": { kind: "call", run: (args) => localRunCleanup(String(args[0] ?? "")) },
  // Veritabanı yöneticisi: bağlantı bilgisi (parola dahil) istekle gelir,
  // ajanda saklanmaz.
  "db.query": {
    kind: "call",
    run: (args) =>
      localRunQuery(
        args[0] as ConnectionSecrets,
        String(args[1] ?? ""),
        (args[2] ?? {}) as Parameters<typeof localRunQuery>[2],
      ),
  },
  "db.tables": { kind: "call", run: (args) => localListTables(args[0] as ConnectionSecrets) },
  "db.structure": {
    kind: "call",
    run: (args) =>
      localTableStructure(args[0] as ConnectionSecrets, String(args[1] ?? ""), String(args[2] ?? "")),
  },
  "db.test": { kind: "call", run: (args) => localTestConnection(args[0] as ConnectionSecrets) },
  "db.read": {
    kind: "call",
    run: (args) =>
      localReadTable(
        args[0] as ConnectionSecrets,
        String(args[1] ?? ""),
        String(args[2] ?? ""),
        (args[3] ?? { limit: 50, offset: 0 }) as Parameters<typeof localReadTable>[3],
      ),
  },
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
  // Helper: eylem bu sunucunun helper'ına iletilir; asıl izin listesi helper'ın
  // kendi allow.conf'u. Burada yalnızca uzaktan yönetilen alanlar geçer.
  "helper.call": {
    kind: "call",
    run: async (args) => {
      const action = String(args[0] ?? "");
      if (!remoteHelperAllowed(action)) throw new Error(serverT("hosts.errors.unsupported"));
      const actor = (args[2] ?? {}) as { username?: unknown; userId?: unknown };
      return callLocalHelper(
        action as HelperAction,
        (args[1] ?? {}) as Record<string, unknown>,
        { username: String(actor.username ?? "?"), userId: Number(actor.userId ?? 0) },
        Number(args[3]) || undefined,
        args[4] === undefined ? undefined : String(args[4]),
      );
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
