import "server-only";

import { createReadStream, mkdirSync, rmSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";

import { dataDir } from "@/lib/db/client";
import { currentHostId, LOCAL_HOST_ID, runWithHost } from "@/lib/hosts/context";
import { serverT } from "@/lib/i18n/runtime";
import { getDockerProvider } from "@/lib/providers";
import { getNumber } from "@/lib/settings";
import { HOST_MOUNT } from "./discover";
import { finishLiveRun, isJobActive, registerRun, updateRun } from "./live";
import { repoKey, withRepoLock } from "./queue";
import {
  lsArgs,
  parseDiff,
  parseLs,
  parseResticLine,
  parseSnapshots,
  RESTORE_MOUNT,
  restoreArgs,
  STAGE_MOUNT,
} from "./restic";
import { resticRun, resticShell, resticStream, shellRun, stagingVolume } from "./runner";
import { credentialEnv, dbTarget, dumpFileName, loadScript, panelDataSource, stageDir } from "./sources";
import { getJob } from "./store/jobs";
import { repoSecrets, type RepoSecrets } from "./store/repos";
import { finishRun, startRun } from "./store/runs";
import { initialProgress, tagFor } from "./engine";
import type { BackupJob, Snapshot, SnapshotDiff, SnapshotEntry } from "./types";

/**
 * Snapshot gezinme, geri yükleme, indirme ve karşılaştırma.
 *
 * Geri yükleme yedekleme yolundaki TEK yazma işlemi. Varsayılan "yeni klasöre
 * çıkar"; orijinal yerine yazma (OS, container, veritabanı) ayrı modlar ve
 * arayüzde ad yazdırılarak onaylanıyor.
 */

const SNAPSHOT_ID = /^[0-9a-f]{8,64}$/;

/** Host'ta geri yüklemenin asla yazamayacağı hedefler (yeni klasöre çıkarma). */
const FORBIDDEN_TARGETS = ["/", "/etc", "/usr", "/bin", "/sbin", "/lib", "/boot", "/proc", "/sys", "/dev", "/run", "/var/lib/docker"];

export function validateTarget(target: string): string | null {
  if (!target.startsWith("/") || target.includes("..")) return serverT("api.backup.targetAbsolute");
  const clean = target.replace(/\/+$/, "") || "/";
  if (FORBIDDEN_TARGETS.some((forbidden) => clean === forbidden || (forbidden !== "/" && clean.startsWith(`${forbidden}/`)))) {
    return serverT("api.backup.targetForbidden", { target });
  }
  return null;
}

function cleanIncludes(includes: unknown): string[] {
  return (Array.isArray(includes) ? includes : [])
    .map((entry) => String(entry).trim())
    .filter((entry) => entry.startsWith("/") && !entry.includes(".."))
    .slice(0, 500);
}

type JobContext = { job: BackupJob; repo: RepoSecrets };

export function jobContext(jobId: number): JobContext | { error: string } {
  const job = getJob(jobId);
  if (!job) return { error: serverT("api.notFound.job") };
  const repo = repoSecrets(job.repoId);
  if (!repo) return { error: serverT("api.backup.repoPasswordMaster") };
  return { job, repo };
}

/* --- Okuma --- */

export async function listJobSnapshots(context: JobContext): Promise<Snapshot[]> {
  const result = await resticRun(context.repo, ["snapshots", "--json", "--tag", tagFor(context.job)], {
    namePrefix: "panel-restic-snapshots",
  });
  if (result.exitCode !== 0) throw new Error(result.output.trim().slice(0, 500) || "restic snapshots");
  return parseSnapshots(result.stdout ?? result.output);
}

/** Snapshot bu işe mi ait? Başka bir işin (ya da sunucunun) snapshot'ı açılamasın. */
async function assertOwned(context: JobContext, snapshotId: string): Promise<void> {
  if (!SNAPSHOT_ID.test(snapshotId)) throw new Error(serverT("api.backup.snapshotRequired"));
  const snapshots = await listJobSnapshots(context);
  if (!snapshots.some((snapshot) => snapshot.id === snapshotId || snapshot.shortId === snapshotId)) {
    throw new Error(serverT("api.backup.snapshotNotFound"));
  }
}

export async function browseSnapshot(context: JobContext, snapshotId: string, dir: string): Promise<SnapshotEntry[]> {
  if (!SNAPSHOT_ID.test(snapshotId)) throw new Error(serverT("api.backup.snapshotRequired"));
  const clean = dir.startsWith("/") && !dir.includes("..") ? dir : "/";
  const result = await resticRun(context.repo, lsArgs(snapshotId, clean), { namePrefix: "panel-restic-ls" });
  if (result.exitCode !== 0) throw new Error(result.output.trim().slice(0, 500));
  return parseLs(result.stdout ?? result.output, clean);
}

export async function diffSnapshots(context: JobContext, from: string, to: string): Promise<SnapshotDiff> {
  if (!SNAPSHOT_ID.test(from) || !SNAPSHOT_ID.test(to)) throw new Error(serverT("api.backup.snapshotRequired"));
  const result = await resticRun(context.repo, ["diff", from, to, "--json"], { namePrefix: "panel-restic-diff" });
  if (result.exitCode !== 0) throw new Error(result.output.trim().slice(0, 500));
  return parseDiff(result.stdout ?? result.output);
}

/** Tek snapshot'ı siler (forget + prune). */
export async function forgetSnapshot(context: JobContext, snapshotId: string): Promise<void> {
  await assertOwned(context, snapshotId);
  const hostId = currentHostId();
  await withRepoLock(repoKey(hostId, context.repo.id), async () => {
    const result = await resticRun(context.repo, ["forget", snapshotId, "--prune"], { namePrefix: "panel-restic-forget" });
    if (result.exitCode !== 0) throw new Error(result.output.trim().slice(0, 500));
  });
}

/* --- Geri yükleme --- */

export type RestoreRequest =
  /** Seçilenleri (ya da tümünü) host'ta yeni bir klasöre çıkar. */
  | { mode: "folder"; snapshotId: string; includes: string[]; target: string }
  /** İşletim sistemi: seçilenleri orijinal yerlerine yaz (değişenler). */
  | { mode: "original"; snapshotId: string; includes: string[] }
  /** Docker: container'ın volume/bind'larını snapshot anına döndür. */
  | { mode: "container"; snapshotId: string; container: string }
  /** Veritabanı: dökümü çalışan veritabanına yükle. */
  | { mode: "database"; snapshotId: string; container: string };

export function parseRestoreRequest(body: Record<string, unknown>): RestoreRequest | string {
  const snapshotId = String(body.snapshotId ?? "").trim();
  if (!SNAPSHOT_ID.test(snapshotId)) return serverT("api.backup.snapshotRequired");
  const mode = String(body.mode ?? "folder");
  if (mode === "folder") {
    const target = String(body.target ?? "").trim();
    const error = validateTarget(target);
    if (error) return error;
    return { mode, snapshotId, includes: cleanIncludes(body.includes), target };
  }
  if (mode === "original") return { mode, snapshotId, includes: cleanIncludes(body.includes) };
  if (mode === "container" || mode === "database") {
    const container = String(body.container ?? "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(container)) return serverT("api.invalidRequest");
    return { mode, snapshotId, container };
  }
  return serverT("api.invalidRequest");
}

export type StartOutcome = { ok: true; runId: number } | { ok: false; error: string };

export function startRestore(jobId: number, request: RestoreRequest, actor: string): StartOutcome {
  const context = jobContext(jobId);
  if ("error" in context) return { ok: false, error: context.error };
  const { job } = context;
  if (isJobActive(job.id)) return { ok: false, error: serverT("backupEngine.alreadyRunning") };
  if (request.mode === "original" && job.category !== "os") return { ok: false, error: serverT("api.invalidRequest") };
  if (request.mode === "container" && job.category !== "docker") return { ok: false, error: serverT("api.invalidRequest") };
  if (request.mode === "database" && job.category !== "database") return { ok: false, error: serverT("api.invalidRequest") };

  const hostId = currentHostId();
  const runId = startRun(job.id, "restore", actor);
  const signal = registerRun(hostId, { ...initialProgress(runId, job.id, job.category, "restore"), phase: "restoring" });

  void runWithHost(hostId, () => executeRestore(context, request, runId, signal, hostId)).catch((error) => {
    console.error(`[backup] geri yükleme ${runId} beklenmedik hata:`, error);
  });
  return { ok: true, runId };
}

type ContainerManifest = {
  name: string;
  mounts: { type: "volume" | "bind"; source: string; destination: string; path: string }[];
};

async function executeRestore(
  context: JobContext,
  request: RestoreRequest,
  runId: number,
  signal: AbortSignal,
  hostId: number,
): Promise<void> {
  const { job, repo } = context;
  const startedAt = Date.now();
  const log: string[] = [];
  const stopped: string[] = [];

  const onLine = (line: string) => {
    const parsed = parseResticLine(line);
    if (parsed.type === "status") {
      updateRun(runId, {
        phase: "restoring",
        percent: parsed.progress.percent,
        filesDone: parsed.progress.filesDone,
        totalFiles: parsed.progress.totalFiles,
        bytesDone: parsed.progress.bytesDone,
        totalBytes: parsed.progress.totalBytes,
        secondsRemaining: parsed.progress.secondsRemaining,
      });
    } else if (parsed.type === "error") {
      log.push(`${parsed.item}: ${parsed.message}`);
    } else if (parsed.type === "text" && parsed.text) {
      log.push(parsed.text);
    }
  };

  const restore = async (snapshot: string, includes: string[], bind: string, options: { overwrite?: boolean; exact?: boolean } = {}) => {
    const result = await resticStream(
      repo,
      restoreArgs(snapshot, includes, { ...options, limitDownloadKb: repo.options.limitDownloadKb }),
      { binds: [bind], signal, onLine, namePrefix: "panel-restic-restore" },
    );
    if (result.cancelled) throw new Error(serverT("backupEngine.cancelled"));
    if (result.exitCode !== 0) {
      log.push(...result.tail.slice(-20));
      throw new Error(log.slice(-8).join("\n").slice(-800) || serverT("backupEngine.resticExit", { code: result.exitCode }));
    }
  };

  try {
    let message = "";
    await withRepoLock(
      repoKey(hostId, repo.id),
      async () => {
        await assertOwned(context, request.snapshotId);
        updateRun(runId, { phase: "restoring", message: serverT("backupEngine.phase.restoring") });

        switch (request.mode) {
          case "folder":
            await restore(request.snapshotId, request.includes, `${request.target}:${RESTORE_MOUNT}`);
            message = serverT("api.backup.restored", { id: request.snapshotId.slice(0, 8), target: request.target });
            break;

          case "original": {
            // id:/host → host kökü; include yolları /host önekinden arındırılır.
            const includes = request.includes.map((entry) =>
              entry.startsWith(`${HOST_MOUNT}/`) ? entry.slice(HOST_MOUNT.length) : entry,
            );
            await restore(`${request.snapshotId}:${HOST_MOUNT}`, includes, `/:${RESTORE_MOUNT}`, { overwrite: true });
            message = serverT("backupEngine.restoredOriginal", { count: includes.length || 1 });
            break;
          }

          case "container": {
            const manifestPath = `${stageDir(job.id)}/docker/${request.container.replace(/[^A-Za-z0-9._-]+/g, "_")}.json`;
            const manifestResult = await resticRun(repo, ["dump", request.snapshotId, manifestPath], {
              namePrefix: "panel-restic-dump",
            });
            if (manifestResult.exitCode !== 0) throw new Error(serverT("backupEngine.manifestMissing", { name: request.container }));
            const manifest = JSON.parse(manifestResult.stdout ?? manifestResult.output) as ContainerManifest;

            const state = await getDockerProvider().inspect(request.container).catch(() => null);
            if (state?.running) {
              updateRun(runId, { phase: "stopping", message: serverT("backupEngine.phase.stopping", { name: request.container }) });
              await getDockerProvider().action(request.container, "stop", getNumber("docker.stop_timeout"));
              stopped.push(request.container);
            }
            for (const mount of manifest.mounts) {
              updateRun(runId, { phase: "restoring", message: mount.destination });
              await restore(`${request.snapshotId}:${mount.path}`, [], `${mount.source}:${RESTORE_MOUNT}`, { exact: true });
            }
            message = serverT("backupEngine.restoredContainer", { name: request.container, count: manifest.mounts.length });
            break;
          }

          case "database": {
            const target = await dbTarget(request.container);
            const dumpPath = `${stageDir(job.id)}/db`;
            await restore(`${request.snapshotId}:${dumpPath}`, [`/${dumpFileName(request.container)}`], `${stagingVolume()}:${RESTORE_MOUNT}`, {});
            // restic hedefin köküne açtı: /restore/<dosya> → staging kökünde.
            const file = `${STAGE_MOUNT}/${dumpFileName(request.container)}`;
            updateRun(runId, { phase: "restoring", message: serverT("backupEngine.phase.loading", { name: request.container }) });
            const result = await shellRun(loadScript(target.engine, target.credentials, file), {
              image: target.image,
              binds: [`${stagingVolume()}:${STAGE_MOUNT}`],
              env: credentialEnv(target.engine, target.credentials.password),
              networkMode: `container:${request.container}`,
              namePrefix: "panel-backup-load",
            });
            await shellRun(`rm -f ${file}`, {
              binds: [`${stagingVolume()}:${STAGE_MOUNT}`],
            }).catch(() => undefined);
            if (result.exitCode !== 0) {
              throw new Error(serverT("backupEngine.loadFailed", { output: result.output.trim().slice(-500) }));
            }
            message = serverT("backupEngine.restoredDatabase", { name: request.container });
            break;
          }
        }
      },
      () => updateRun(runId, { phase: "queued", message: serverT("backupEngine.phase.queued") }),
    );

    await restartAll(stopped, log);
    finishRun(runId, { status: "ok", snapshotId: request.snapshotId, durationMs: Date.now() - startedAt, detail: message, log: log.join("\n") });
    finishLiveRun(runId, { status: "ok", message, percent: 100 });
  } catch (error) {
    await restartAll(stopped, log);
    const detail = error instanceof Error ? error.message : String(error);
    const status = signal.aborted ? "cancelled" : "error";
    finishRun(runId, { status, snapshotId: request.snapshotId, durationMs: Date.now() - startedAt, detail, log: log.join("\n") });
    finishLiveRun(runId, { status, message: detail });
  }
}

async function restartAll(stopped: string[], log: string[]): Promise<void> {
  while (stopped.length > 0) {
    const name = stopped.shift() as string;
    try {
      await getDockerProvider().action(name, "start", 0);
    } catch (error) {
      log.push(serverT("backupEngine.restartFailed", { name, error: error instanceof Error ? error.message : String(error) }));
    }
  }
}

/* --- İndirme (yalnızca panelin kendi sunucusu) --- */

const DOWNLOAD_DIR = "backup-downloads";

export function downloadSupported(): boolean {
  return currentHostId() === LOCAL_HOST_ID;
}

/**
 * Snapshot'tan dosya ya da klasör (zip) hazırlar ve akış olarak döndürür.
 * restic çıktısı panelin veri volume'üne yazılır, okununca silinir.
 */
export async function prepareDownload(
  context: JobContext,
  snapshotId: string,
  entryPath: string,
  isDir: boolean,
): Promise<{ name: string; size: number; stream: ReadableStream<Uint8Array> }> {
  if (!downloadSupported()) throw new Error(serverT("backupEngine.downloadLocalOnly"));
  if (!SNAPSHOT_ID.test(snapshotId) || !entryPath.startsWith("/") || entryPath.includes("..")) {
    throw new Error(serverT("api.invalidRequest"));
  }
  const source = await panelDataSource();
  if (!source) throw new Error(serverT("backupEngine.noPanelVolume"));

  const token = randomBytes(8).toString("hex");
  const base = (entryPath.split("/").filter(Boolean).pop() ?? "snapshot").replace(/[^A-Za-z0-9._-]+/g, "_");
  const name = isDir ? `${base}.zip` : base;
  const localDir = path.join(dataDir(), DOWNLOAD_DIR);
  mkdirSync(localDir, { recursive: true });
  const fileName = `${token}-${name}`;

  const quoted = `'${entryPath.replace(/'/g, "'\\''")}'`;
  const script = `mkdir -p /out/${DOWNLOAD_DIR} && restic dump ${isDir ? "--archive zip " : ""}${snapshotId} ${quoted} > /out/${DOWNLOAD_DIR}/${fileName}`;
  const result = await resticShell(context.repo, script, { binds: [`${source}:/out`], namePrefix: "panel-restic-dump" });
  const localFile = path.join(localDir, fileName);
  if (result.exitCode !== 0) {
    rmSync(localFile, { force: true });
    throw new Error(result.output.trim().slice(0, 500));
  }

  const size = statSync(localFile).size;
  const nodeStream = createReadStream(localFile);
  // Okuma bitince (ya da koparsa) dosya silinir.
  const remove = () => rmSync(localFile, { force: true });
  nodeStream.on("close", remove);
  return { name, size, stream: Readable.toWeb(nodeStream) as ReadableStream<Uint8Array> };
}
