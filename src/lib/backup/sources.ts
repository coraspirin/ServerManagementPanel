import "server-only";

import { rmSync, statSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";

import { dataDir, getDb } from "@/lib/db/client";
import { connectionSecrets } from "@/lib/dbadmin/store";
import { listConnections } from "@/lib/dbadmin/store";
import { currentHostId, LOCAL_HOST_ID } from "@/lib/hosts/context";
import { panelContainerName } from "@/lib/host/self";
import { serverT } from "@/lib/i18n/runtime";
import {
  credentialsFromEnv,
  dbEngineOf,
  existingHostPaths,
  HOST_MOUNT,
  inspectContainer,
  isSystemBind,
  toMounts,
} from "./discover";
import { LEGACY_MOUNT, slug, SOURCE_ROOT, STAGE_MOUNT } from "./restic";
import { shellRun, stagingVolume } from "./runner";
import { getSystemJob } from "./store/jobs";
import type { BackupJob, DbEngineKind, DockerMount } from "./types";

/**
 * Bir işin kaynaklarını restic için hazırlar: hangi yol nereye bağlanacak,
 * hangi yollar yedeklenecek, hangi container'lar durdurulacak.
 *
 * Yerleşim (restic container'ı içinde):
 *   /src/docker/<container>/<hedef>   container volume'leri ve bind'ları (ro)
 *   /src/docker/_compose/<proje>      compose klasörü (ro)
 *   /host/<yol>                       işletim sistemi (host kökü, ro)
 *   /stage/job-<id>/...               dökümler ve container manifestleri
 *   /data                             v1'den taşınan tek kaynaklı işler
 */

export type Prepared = {
  binds: string[];
  paths: string[];
  excludes: string[];
  stopContainers: string[];
  notes: string[];
  warnings: string[];
  /** Staging kullanıldıysa temizler; hata fırlatmaz. */
  cleanup: () => Promise<void>;
};

export type PrepareHooks = {
  onPhase: (phase: "preparing" | "dumping", message: string) => void;
};

const PANEL_SNAPSHOT_NAME = "panel-db-snapshot.db";
const PANEL_DATA_MOUNT = "/panel";

/** Panel volume'ü yedeklenirken canlı DB dosyaları dışarıda (tutarlı kopyası var). */
const PANEL_DB_EXCLUDES = [
  `${LEGACY_MOUNT}/panel.db`,
  `${LEGACY_MOUNT}/panel.db-wal`,
  `${LEGACY_MOUNT}/panel.db-shm`,
  `${LEGACY_MOUNT}/backups/pre-migration-*.db`,
];

export function stageDir(jobId: number): string {
  return `${STAGE_MOUNT}/job-${jobId}`;
}

export function dockerSourcePath(container: string, destination: string): string {
  return `${SOURCE_ROOT}/docker/${slug(container)}/${slug(destination)}`;
}

export function composeSourcePath(project: string): string {
  return `${SOURCE_ROOT}/docker/_compose/${slug(project)}`;
}

export function dumpFileName(container: string): string {
  return `${slug(container)}.sql`;
}

/** Bir bind satırı: Docker'ın "kaynak:hedef:ro" sözdizimi. */
function roBind(source: string, target: string): string {
  return `${source}:${target}:ro`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Panel veritabanının tutarlı kopyası. Canlı dosyayı kopyalamak WAL yüzünden
 * yarım bir veritabanı üretir; `VACUUM INTO` her zaman açılabilir tek dosya yazar.
 */
function vacuumPanelDb(): { file: string; bytes: number } {
  const target = path.join(dataDir(), "backups", PANEL_SNAPSHOT_NAME);
  // VACUUM INTO var olan dosyanın üzerine YAZMAZ; önceki kopya silinmeli.
  rmSync(target, { force: true });
  getDb().prepare("VACUUM INTO ?").run(target);
  return { file: target, bytes: statSync(target).size };
}

/** Panelin veri klasörünün geldiği yer: named volume adı ya da host yolu. */
export async function panelDataSource(): Promise<string | null> {
  for (const candidate of [panelContainerName(), hostname()]) {
    const raw = await inspectContainer(candidate);
    if (!raw) continue;
    const mount = toMounts(raw.Mounts).find(
      (entry) => entry.destination === dataDir() || entry.destination === "/app/data",
    );
    if (mount) return mount.source;
  }
  return null;
}

export async function prepareSources(job: BackupJob, hooks: PrepareHooks): Promise<Prepared> {
  const prepared: Prepared = {
    binds: [],
    paths: [],
    excludes: [...job.options.excludes],
    stopContainers: [],
    notes: [],
    warnings: [],
    cleanup: async () => undefined,
  };
  const enabled = job.sources.filter((source) => source.enabled);
  if (enabled.length === 0) throw new Error(serverT("backupEngine.noSources"));

  hooks.onPhase("preparing", serverT("backupEngine.phase.preparing"));

  // Staging: dökümler ve manifestler için. Yalnızca gerekirse açılır.
  let staging = false;
  const staged: { file: string; content: string }[] = [];
  const openStaging = async () => {
    if (staging) return;
    const dir = stageDir(job.id);
    const result = await shellRun(`rm -rf ${dir} && mkdir -p ${dir}/docker ${dir}/db`, {
      binds: [`${stagingVolume()}:${STAGE_MOUNT}`],
    });
    if (result.exitCode !== 0) throw new Error(serverT("backupEngine.stagingFailed", { output: result.output.slice(0, 300) }));
    staging = true;
    prepared.cleanup = async () => {
      try {
        await shellRun(`rm -rf ${dir}`, { binds: [`${stagingVolume()}:${STAGE_MOUNT}`] });
      } catch {
        // Bir sonraki koşu başında zaten temizleniyor.
      }
    };
  };

  for (const source of enabled) {
    switch (source.kind) {
      case "volume":
      case "host_dir":
      case "panel_db":
        if (source.options.legacy || job.category === "custom") {
          await prepareLegacy(source.kind, source.ref, prepared);
        } else if (source.kind === "panel_db") {
          await preparePanelDb(prepared);
        }
        break;

      case "container": {
        const raw = await inspectContainer(source.ref);
        if (!raw) {
          prepared.warnings.push(serverT("backupEngine.containerMissing", { name: source.ref }));
          break;
        }
        await openStaging();
        const mounts = toMounts(raw.Mounts);
        const included: (DockerMount & { path: string })[] = [];
        for (const mount of mounts) {
          if (mount.skipped) continue;
          const target = dockerSourcePath(source.ref, mount.destination);
          prepared.binds.push(roBind(mount.source, target));
          included.push({ ...mount, path: target });
        }
        const labels = raw.Config?.Labels ?? {};
        const project = labels["com.docker.compose.project"] ?? "";
        const composeDir = labels["com.docker.compose.project.working_dir"] ?? "";
        if (project && composeDir && !isSystemBind(composeDir)) {
          const target = composeSourcePath(project);
          if (!prepared.binds.some((bind) => bind.split(":")[1] === target)) {
            prepared.binds.push(roBind(composeDir, target));
          }
        }
        staged.push({
          file: `docker/${slug(source.ref)}.json`,
          content: JSON.stringify({
            name: source.ref,
            image: raw.Config?.Image ?? "",
            composeProject: project,
            composeDir,
            composePath: project ? composeSourcePath(project) : "",
            mounts: included,
            inspect: raw,
          }),
        });
        if (source.options.stop && raw.State?.Status === "running") prepared.stopContainers.push(source.ref);
        break;
      }

      case "db": {
        await openStaging();
        hooks.onPhase("dumping", serverT("backupEngine.phase.dumping", { name: source.ref }));
        const outcome = await dumpDatabase(source.ref, `${stageDir(job.id)}/db/${dumpFileName(source.ref)}`);
        if (outcome.ok) prepared.notes.push(outcome.note);
        else prepared.warnings.push(outcome.note);
        break;
      }
    }
  }

  if (job.category === "os") {
    const wanted = enabled.filter((source) => source.kind === "host_dir").map((source) => source.ref);
    const existing = await existingHostPaths(wanted);
    const missing = wanted.filter((entry) => !existing.has(entry));
    for (const entry of missing) prepared.warnings.push(serverT("backupEngine.pathMissing", { path: entry }));
    if (existing.size > 0) {
      prepared.binds.push(roBind("/", HOST_MOUNT));
      prepared.paths.push(...[...existing].map((entry) => `${HOST_MOUNT}${entry}`));
      prepared.excludes.push(`${HOST_MOUNT}/home/*/.cache`, `${HOST_MOUNT}/root/.cache`);
      prepared.excludes.push(...(await dockerCoveredExcludes()));
    }
  }

  if (prepared.binds.some((bind) => bind.includes(`:${SOURCE_ROOT}/`))) prepared.paths.push(SOURCE_ROOT);

  if (staged.length > 0 || staging) {
    if (staged.length > 0) await writeStaged(job.id, staged);
    prepared.binds.push(roBind(stagingVolume(), STAGE_MOUNT));
    prepared.paths.push(stageDir(job.id));
  }

  if (prepared.paths.length === 0) {
    await prepared.cleanup();
    throw new Error(
      prepared.warnings.length > 0 ? prepared.warnings.join(" · ") : serverT("backupEngine.noSources"),
    );
  }
  return prepared;
}

/** v1 işleri: tek kaynak `/data`'ya — restic aynı yolu görüp parent'ı bulsun. */
async function prepareLegacy(kind: string, ref: string, prepared: Prepared): Promise<void> {
  if (kind === "panel_db") {
    if (currentHostId() !== LOCAL_HOST_ID) throw new Error(serverT("backupEngine.panelDbLocalOnly"));
    const source = await panelDataSource();
    if (!source) throw new Error(serverT("backupEngine.noPanelVolume"));
    const snapshot = vacuumPanelDb();
    prepared.notes.push(serverT("backupEngine.dbCopy", { size: formatBytes(snapshot.bytes) }));
    prepared.excludes.push(...PANEL_DB_EXCLUDES);
    prepared.binds.push(roBind(source, LEGACY_MOUNT));
  } else {
    prepared.binds.push(roBind(ref, LEGACY_MOUNT));
  }
  prepared.paths.push(LEGACY_MOUNT);
}

async function preparePanelDb(prepared: Prepared): Promise<void> {
  if (currentHostId() !== LOCAL_HOST_ID) {
    prepared.warnings.push(serverT("backupEngine.panelDbLocalOnly"));
    return;
  }
  const source = await panelDataSource();
  if (!source) {
    prepared.warnings.push(serverT("backupEngine.noPanelVolume"));
    return;
  }
  const snapshot = vacuumPanelDb();
  prepared.notes.push(serverT("backupEngine.dbCopy", { size: formatBytes(snapshot.bytes) }));
  prepared.binds.push(roBind(source, PANEL_DATA_MOUNT));
  prepared.paths.push(panelSnapshotPath());
}

/** Snapshot içindeki panel DB kopyasının yolu. */
export function panelSnapshotPath(): string {
  return `${PANEL_DATA_MOUNT}/backups/${PANEL_SNAPSHOT_NAME}`;
}

/** Docker bölümünün zaten yedeklediği host yolları OS yedeğine tekrar girmesin. */
async function dockerCoveredExcludes(): Promise<string[]> {
  const job = getSystemJob("docker");
  if (!job || !job.enabled) return [];
  const excludes = new Set<string>();
  for (const source of job.sources) {
    if (!source.enabled || source.kind !== "container") continue;
    const raw = await inspectContainer(source.ref);
    if (!raw) continue;
    for (const mount of toMounts(raw.Mounts)) {
      if (mount.type === "bind" && !mount.skipped && mount.source !== "/") excludes.add(`${HOST_MOUNT}${mount.source}`);
    }
    const dir = raw.Config?.Labels?.["com.docker.compose.project.working_dir"];
    if (dir && !isSystemBind(dir)) excludes.add(`${HOST_MOUNT}${dir}`);
  }
  return [...excludes];
}

/** Manifest dosyalarını staging'e yazar (ortam değişkeniyle; container'a stdin yok). */
async function writeStaged(jobId: number, files: { file: string; content: string }[]): Promise<void> {
  const env: Record<string, string> = {};
  const lines = files.map((entry, index) => {
    env[`F_${index}`] = entry.content;
    return `printf '%s' "$F_${index}" > ${shellQuote(`${stageDir(jobId)}/${entry.file}`)}`;
  });
  const result = await shellRun(lines.join(" && "), {
    binds: [`${stagingVolume()}:${STAGE_MOUNT}`],
    env,
  });
  if (result.exitCode !== 0) throw new Error(serverT("backupEngine.stagingFailed", { output: result.output.slice(0, 300) }));
}

/* --- Veritabanı dökümü --- */

type DumpCredentials = { user: string; password: string; database: string; all: boolean; port: number };

async function resolveCredentials(
  container: string,
  engine: DbEngineKind,
  env: Record<string, string>,
): Promise<DumpCredentials | null> {
  const fromEnv = credentialsFromEnv(engine, env);
  const defaultPort = engine === "postgres" ? Number(env.PGPORT ?? 5432) : Number(env.MYSQL_TCP_PORT ?? 3306);
  if (fromEnv) return { ...fromEnv, port: defaultPort };
  const connection = listConnections().find((entry) => entry.container === container);
  const secrets = connection ? connectionSecrets(connection.id) : null;
  if (!secrets) return null;
  return {
    user: secrets.username,
    password: secrets.password,
    database: secrets.database,
    all: !secrets.database,
    port: defaultPort,
  };
}

/** Döküm/yükleme komutu — DB container'ının KENDİ imajında çalışır (istemci sürümü eşleşsin). */
export function dumpScript(engine: DbEngineKind, credentials: DumpCredentials, file: string): string {
  const target = shellQuote(file);
  if (engine === "postgres") {
    return credentials.all
      ? `pg_dumpall -h 127.0.0.1 -p ${credentials.port} -U ${shellQuote(credentials.user)} --clean --if-exists > ${target}`
      : `pg_dump -h 127.0.0.1 -p ${credentials.port} -U ${shellQuote(credentials.user)} --clean --if-exists --create ${shellQuote(credentials.database)} > ${target}`;
  }
  const tool = 'DUMP=$(command -v mariadb-dump || command -v mysqldump) || { echo "mysqldump not found" >&2; exit 127; }';
  const scope = credentials.all ? "--all-databases" : `--databases ${shellQuote(credentials.database)}`;
  return `${tool}; "$DUMP" -h 127.0.0.1 -P ${credentials.port} -u ${shellQuote(credentials.user)} ${scope} --single-transaction --routines --events --triggers > ${target}`;
}

export function loadScript(engine: DbEngineKind, credentials: DumpCredentials, file: string): string {
  const source = shellQuote(file);
  if (engine === "postgres") {
    return `psql -h 127.0.0.1 -p ${credentials.port} -U ${shellQuote(credentials.user)} -v ON_ERROR_STOP=0 -d postgres -f ${source}`;
  }
  const tool = 'CLIENT=$(command -v mariadb || command -v mysql) || { echo "mysql client not found" >&2; exit 127; }';
  return `${tool}; "$CLIENT" -h 127.0.0.1 -P ${credentials.port} -u ${shellQuote(credentials.user)} < ${source}`;
}

export function credentialEnv(engine: DbEngineKind, password: string): Record<string, string> {
  if (!password) return {};
  return engine === "postgres" ? { PGPASSWORD: password } : { MYSQL_PWD: password };
}

export type DbTarget = {
  engine: DbEngineKind;
  image: string;
  credentials: DumpCredentials;
};

/** Döküm/yükleme için container bilgisi; hazır değilse açıklamalı hata. */
export async function dbTarget(container: string): Promise<DbTarget> {
  const raw = await inspectContainer(container);
  if (!raw) throw new Error(serverT("backupEngine.containerMissing", { name: container }));
  const image = raw.Config?.Image ?? "";
  const engine = dbEngineOf(image);
  if (!engine) throw new Error(serverT("backupEngine.notDatabase", { name: container }));
  if (raw.State?.Status !== "running") throw new Error(serverT("backupEngine.dbNotRunning", { name: container }));
  const env: Record<string, string> = {};
  for (const entry of raw.Config?.Env ?? []) {
    const index = entry.indexOf("=");
    if (index > 0) env[entry.slice(0, index)] = entry.slice(index + 1);
  }
  const credentials = await resolveCredentials(container, engine, env);
  if (!credentials) throw new Error(serverT("backupEngine.dbNoCredentials", { name: container }));
  return { engine, image, credentials };
}

async function dumpDatabase(container: string, file: string): Promise<{ ok: boolean; note: string }> {
  try {
    const target = await dbTarget(container);
    const result = await shellRun(dumpScript(target.engine, target.credentials, file), {
      image: target.image,
      binds: [`${stagingVolume()}:${STAGE_MOUNT}`],
      env: credentialEnv(target.engine, target.credentials.password),
      // DB container'ının ağ ad alanı: 127.0.0.1 doğrudan veritabanı.
      networkMode: `container:${container}`,
      namePrefix: "panel-backup-dump",
    });
    if (result.exitCode !== 0) {
      return {
        ok: false,
        note: serverT("backupEngine.dumpFailed", { name: container, output: result.output.trim().slice(0, 300) }),
      };
    }
    return { ok: true, note: serverT("backupEngine.dumped", { name: container }) };
  } catch (error) {
    return { ok: false, note: error instanceof Error ? error.message : String(error) };
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[index]}`;
}
