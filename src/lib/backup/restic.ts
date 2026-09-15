import "server-only";

import { getDockerProvider } from "@/lib/providers";
import { getNumber, getString } from "@/lib/settings";
import type { ExecResult } from "@/lib/providers/types";
import type { RepoSecrets } from "./store";
import type { Snapshot } from "./types";

/**
 * M3.4 — restic sarmalayıcısı.
 *
 * restic HOST'A KURULMUYOR. Her komut, tek seferlik bir container içinde
 * çalışıyor. Üç sebep:
 *   1. Host'a paket kurmak panelin işi değil; sürüm imajla sabit kalıyor.
 *   2. host-helper izin listesine yeni satır gerekmiyor — panel yalnızca zaten
 *      sahip olduğu docker.sock'u kullanıyor.
 *   3. Kaynak dizin/volume container'a salt-okunur bağlanıyor; restic'in
 *      yedeklediği veriyi değiştirmesi teknik olarak mümkün değil.
 *
 * SINIR: parola container'a ortam değişkeniyle geçiyor ve `docker inspect` ile
 * görülebilir. Bu, docker.sock'a erişebilen birinin zaten host'ta root olduğu
 * gerçeğinin yanında yeni bir açık değil — ama bilinerek kabul edilmiş bir
 * ödün, dolayısıyla burada yazıyor.
 */

const REPO_MOUNT = "/repo";
const DATA_MOUNT = "/data";
const RESTORE_MOUNT = "/restore";

function image(): string {
  return getString("backup.restic_image");
}

function timeoutMs(): number {
  return getNumber("backup.timeout_minutes") * 60_000;
}

/** Yerel depolar container içinde /repo'ya bağlanır; uzak depolar adresiyle gider. */
function repository(repo: RepoSecrets): string {
  return repo.kind === "local" ? REPO_MOUNT : repo.location;
}

function repoBinds(repo: RepoSecrets): string[] {
  return repo.kind === "local" ? [`${repo.location}:${REPO_MOUNT}`] : [];
}

export async function resticRun(
  repo: RepoSecrets,
  args: string[],
  extraBinds: string[] = [],
  namePrefix = "panel-restic",
): Promise<ExecResult> {
  return getDockerProvider().runThrowaway({
    image: image(),
    cmd: args,
    binds: [...repoBinds(repo), ...extraBinds],
    env: {
      RESTIC_REPOSITORY: repository(repo),
      RESTIC_PASSWORD: repo.password,
      // İlerleme satırları JSON akışını kirletiyor ve container'da terminal
      // yok; kapatmak çıktıyı ayrıştırılabilir tutuyor.
      RESTIC_PROGRESS_FPS: "0",
      ...repo.env,
    },
    namePrefix,
    timeoutMs: timeoutMs(),
  });
}

export type RepoCheck = { ok: boolean; initialized: boolean; message: string };

/**
 * Deponun erişilebilir ve parolanın doğru olup olmadığına bakar.
 *
 * `cat config` kullanılıyor, `snapshots` değil: boş bir depoda `snapshots`
 * başarılı döner ama hiçbir şey söylemez; `cat config` deponun gerçekten
 * açılıp açılamadığını sınar.
 */
export async function checkRepo(repo: RepoSecrets): Promise<RepoCheck> {
  const result = await resticRun(repo, ["cat", "config"], [], "panel-restic-check");

  if (result.exitCode === 0) {
    return { ok: true, initialized: true, message: "Depo açıldı." };
  }

  const output = result.output.toLowerCase();
  if (output.includes("unable to open config file") || output.includes("does not exist")) {
    return {
      ok: false,
      initialized: false,
      message: "Depo henüz oluşturulmamış. 'Depoyu oluştur' ile başlatabilirsin.",
    };
  }
  if (output.includes("wrong password") || output.includes("invalid password")) {
    return { ok: false, initialized: true, message: "Depo parolası hatalı." };
  }

  return { ok: false, initialized: false, message: result.output.slice(0, 500) };
}

export async function initRepo(repo: RepoSecrets): Promise<RepoCheck> {
  const result = await resticRun(repo, ["init"], [], "panel-restic-init");
  if (result.exitCode === 0) {
    return { ok: true, initialized: true, message: "Depo oluşturuldu." };
  }
  if (result.output.toLowerCase().includes("already initialized")) {
    return { ok: true, initialized: true, message: "Depo zaten oluşturulmuş." };
  }
  return { ok: false, initialized: false, message: result.output.slice(0, 500) };
}

type SnapshotJson = {
  id: string;
  short_id: string;
  time: string;
  hostname: string;
  paths: string[];
  tags?: string[];
  summary?: { total_bytes_processed?: number };
};

export async function listSnapshots(repo: RepoSecrets, tag?: string): Promise<Snapshot[]> {
  const args = ["snapshots", "--json"];
  if (tag) args.push("--tag", tag);

  const result = await resticRun(repo, args, [], "panel-restic-snap");
  if (result.exitCode !== 0) return [];

  const json = extractJson(result.output);
  if (!json) return [];

  try {
    const parsed = JSON.parse(json) as SnapshotJson[];
    return parsed.map((entry) => ({
      id: entry.id,
      shortId: entry.short_id,
      time: Math.floor(new Date(entry.time).getTime() / 1000),
      hostname: entry.hostname,
      paths: entry.paths ?? [],
      tags: entry.tags ?? [],
      sizeBytes: entry.summary?.total_bytes_processed ?? null,
    }));
  } catch {
    return [];
  }
}

export type BackupSummary = {
  snapshotId: string;
  filesNew: number;
  filesChanged: number;
  bytesAdded: number;
};

/**
 * restic `backup --json` bir SATIR AKIŞI yazar (her satır ayrı bir JSON
 * nesnesi), tek bir belge değil. İhtiyacımız olan son satırdaki "summary"
 * mesajı; gerisi ilerleme bildirimi.
 */
export function parseBackupSummary(output: string): BackupSummary | null {
  for (const line of output.split("\n").reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (parsed.message_type !== "summary") continue;
      return {
        snapshotId: String(parsed.snapshot_id ?? ""),
        filesNew: Number(parsed.files_new ?? 0),
        filesChanged: Number(parsed.files_changed ?? 0),
        bytesAdded: Number(parsed.data_added ?? 0),
      };
    } catch {
      continue;
    }
  }
  return null;
}

export type BackupTarget =
  | { kind: "volume"; name: string }
  | { kind: "path"; hostPath: string };

export async function runResticBackup(
  repo: RepoSecrets,
  target: BackupTarget,
  options: { tag: string; excludes: string[]; hostname: string },
): Promise<{ result: ExecResult; summary: BackupSummary | null }> {
  const bind =
    target.kind === "volume"
      ? `${target.name}:${DATA_MOUNT}:ro`
      : `${target.hostPath}:${DATA_MOUNT}:ro`;

  const args = [
    "backup",
    DATA_MOUNT,
    "--json",
    "--tag",
    options.tag,
    // Snapshot'ın hangi işe ait olduğu hostname'den de okunabilsin; restic
    // container'ının rastgele kimliği hiçbir şey anlatmazdı.
    "--host",
    options.hostname,
  ];
  for (const exclude of options.excludes) {
    if (exclude.trim().length > 0) args.push("--exclude", exclude.trim());
  }

  const result = await resticRun(repo, args, [bind], "panel-restic-backup");
  return { result, summary: parseBackupSummary(result.output) };
}

export type ForgetOutcome = { removed: number; output: string; ok: boolean };

export async function runForget(
  repo: RepoSecrets,
  tag: string,
  keep: { daily: number; weekly: number; monthly: number },
): Promise<ForgetOutcome> {
  const args = [
    "forget",
    "--tag",
    tag,
    "--keep-daily",
    String(keep.daily),
    "--keep-weekly",
    String(keep.weekly),
    "--keep-monthly",
    String(keep.monthly),
    "--prune",
    "--json",
  ];

  const result = await resticRun(repo, args, [], "panel-restic-forget");
  const removed = countRemoved(result.output);
  return { removed, output: result.output, ok: result.exitCode === 0 };
}

function countRemoved(output: string): number {
  const json = extractJson(output);
  if (!json) return 0;
  try {
    const parsed = JSON.parse(json) as { remove?: unknown[] }[];
    return parsed.reduce((total, entry) => total + (entry.remove?.length ?? 0), 0);
  } catch {
    return 0;
  }
}

/**
 * Geri yükleme. Hedef HOST yolu container'a yazılabilir olarak bağlanıyor —
 * bu, yedekleme yolundaki tek yazma işlemi ve bu yüzden ayrı bir izin
 * (`backup.manage`) ve ayrı bir onay istiyor.
 */
export async function runRestore(
  repo: RepoSecrets,
  snapshotId: string,
  targetHostPath: string,
): Promise<ExecResult> {
  return resticRun(
    repo,
    ["restore", snapshotId, "--target", RESTORE_MOUNT],
    [`${targetHostPath}:${RESTORE_MOUNT}`],
    "panel-restic-restore",
  );
}

/** Bir snapshot'ın içeriğini listeler (geri yüklemeden önce bakmak için). */
export async function listSnapshotFiles(
  repo: RepoSecrets,
  snapshotId: string,
  limit = 500,
): Promise<string[]> {
  const result = await resticRun(
    repo,
    ["ls", snapshotId, "--json"],
    [],
    "panel-restic-ls",
  );
  if (result.exitCode !== 0) return [];

  const files: string[] = [];
  for (const line of result.output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as { struct_type?: string; path?: string };
      if (parsed.struct_type === "node" && parsed.path) {
        files.push(parsed.path);
        if (files.length >= limit) break;
      }
    } catch {
      continue;
    }
  }
  return files;
}

/**
 * Çıktının içindeki ilk JSON dizisini/nesnesini ayıklar.
 *
 * restic bazen JSON'un önüne uyarı satırı yazıyor (ör. "repository is already
 * locked"). Ham çıktıyı doğrudan JSON.parse'a vermek bu durumda patlıyor.
 */
function extractJson(output: string): string | null {
  const start = output.search(/[[{]/);
  if (start < 0) return null;
  const end = Math.max(output.lastIndexOf("]"), output.lastIndexOf("}"));
  return end > start ? output.slice(start, end + 1) : null;
}
