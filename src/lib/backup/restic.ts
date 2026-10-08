/**
 * restic komut satırı kurucuları ve `--json` çıktı ayrıştırıcıları.
 *
 * SAF modül: Docker'a, veritabanına ya da ayarlara dokunmaz (testlerden
 * doğrudan import edilir). Komutları çalıştırmak `runner.ts`'in işi.
 */

import type { RepoKind, RepoStats, Snapshot, SnapshotDiff, SnapshotEntry } from "./types";

/** restic container'ı içindeki sabit bağlama noktaları. */
export const REPO_MOUNT = "/repo";
export const STAGE_MOUNT = "/stage";
export const RESTORE_MOUNT = "/restore";
/** v1'den taşınan tek kaynaklı işlerin yolu — parent snapshot için korunur. */
export const LEGACY_MOUNT = "/data";
export const SOURCE_ROOT = "/src";

/* --- Konum adresleri --- */

/** `//sunucu/paylaşım/alt/yol` → Docker cifs aygıtı + paylaşım içi alt yol. */
export function splitSmbLocation(location: string): { device: string; subPath: string } {
  const match = /^\/\/([^/]+)\/([^/]+)(\/.*)?$/.exec(location.trim());
  if (!match) return { device: location.trim(), subPath: "" };
  return { device: `//${match[1]}/${match[2]}`, subPath: (match[3] ?? "").replace(/\/+$/, "") };
}

/** restic'in RESTIC_REPOSITORY değeri. */
export function repositoryUrl(kind: RepoKind, location: string): string {
  if (kind === "local" || kind === "nfs") return REPO_MOUNT;
  if (kind === "smb") return `${REPO_MOUNT}${splitSmbLocation(location).subPath}`;
  return location.trim();
}

/** SMB/NFS konumu için Docker volume sürücü seçenekleri. */
export function mountVolumeOptions(
  kind: "smb" | "nfs",
  location: string,
  env: Record<string, string>,
): Record<string, string> {
  if (kind === "smb") {
    const parts = [
      env.SMB_USERNAME ? `username=${env.SMB_USERNAME}` : "guest",
      env.SMB_PASSWORD ? `password=${env.SMB_PASSWORD}` : "",
      env.SMB_DOMAIN ? `domain=${env.SMB_DOMAIN}` : "",
      env.SMB_VERSION ? `vers=${env.SMB_VERSION}` : "",
      // restic dosyaları root olarak yazar; paylaşımda tutarlı izin.
      "uid=0,gid=0,file_mode=0600,dir_mode=0700",
    ].filter((part) => part.length > 0);
    return { type: "cifs", device: splitSmbLocation(location).device, o: parts.join(",") };
  }
  const [server, ...rest] = location.trim().split(":");
  const exportPath = rest.join(":");
  const extra = env.NFS_OPTIONS?.trim();
  return {
    type: "nfs",
    device: `:${exportPath}`,
    o: [`addr=${server}`, extra && extra.length > 0 ? extra : "rw,nfsvers=4"].join(","),
  };
}

/* --- Argüman kurucular --- */

export type BackupArgs = {
  paths: string[];
  tags: string[];
  host: string;
  excludes: string[];
  limitUploadKb: number;
};

export function backupArgs(options: BackupArgs): string[] {
  const args = ["backup", ...options.paths, "--json", "--host", options.host];
  for (const tag of options.tags) args.push("--tag", tag);
  for (const exclude of options.excludes) {
    if (exclude.trim().length > 0) args.push("--exclude", exclude.trim());
  }
  if (options.limitUploadKb > 0) args.push("--limit-upload", String(options.limitUploadKb));
  return args;
}

export type Retention = { last: number; daily: number; weekly: number; monthly: number };

export function forgetArgs(tag: string, keep: Retention): string[] {
  const args = ["forget", "--tag", tag, "--group-by", "tags", "--prune", "--json"];
  if (keep.last > 0) args.push("--keep-last", String(keep.last));
  if (keep.daily > 0) args.push("--keep-daily", String(keep.daily));
  if (keep.weekly > 0) args.push("--keep-weekly", String(keep.weekly));
  if (keep.monthly > 0) args.push("--keep-monthly", String(keep.monthly));
  return args;
}

/** Saklama kuralının en fazla kaç yedek tutacağı (arayüz önizlemesi). */
export function retentionMax(keep: Retention): number {
  return keep.last + keep.daily + keep.weekly + keep.monthly;
}

/**
 * `snapshot` "id" ya da "id:/alt/klasör" olabilir (restic ≥ 0.14): alt klasör
 * verilirse içeriği hedefin KÖKÜNE açılır ve `--include` yolları ona göredir.
 */
export function restoreArgs(
  snapshot: string,
  includes: string[],
  options: { overwrite?: boolean; exact?: boolean; target?: string; limitDownloadKb?: number } = {},
): string[] {
  const args = ["restore", snapshot, "--target", options.target ?? RESTORE_MOUNT, "--json"];
  for (const include of includes) {
    if (include.trim().length > 0) args.push("--include", include.trim());
  }
  if (options.exact) {
    // Volume'ü snapshot anındaki hâline birebir getir: sonradan eklenenler silinir.
    args.push("--overwrite", "always", "--delete");
  } else if (options.overwrite) {
    // Orijinal yerine: yalnızca değişenler üzerine yazılır.
    args.push("--overwrite", "if-changed");
  }
  if (options.limitDownloadKb && options.limitDownloadKb > 0) {
    args.push("--limit-download", String(options.limitDownloadKb));
  }
  return args;
}

export function lsArgs(snapshotId: string, dir: string): string[] {
  return ["ls", snapshotId, dir || "/", "--json"];
}

/* --- Ayrıştırıcılar --- */

export type ResticProgress = {
  percent: number | null;
  filesDone: number;
  totalFiles: number;
  bytesDone: number;
  totalBytes: number;
  currentFiles: string[];
  secondsRemaining: number | null;
};

export type ResticSummary = {
  snapshotId: string;
  filesNew: number;
  filesChanged: number;
  filesTotal: number;
  bytesAdded: number;
  bytesProcessed: number;
};

export type ResticLine =
  | { type: "status"; progress: ResticProgress }
  | { type: "summary"; summary: ResticSummary }
  | { type: "error"; message: string; item: string }
  | { type: "text"; text: string };

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * `backup --json` / `restore --json` tek satırı. JSON olmayan satırlar (uyarı,
 * "repository is already locked" vb.) `text` olarak döner.
 */
export function parseResticLine(line: string): ResticLine {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return { type: "text", text: trimmed };
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return { type: "text", text: trimmed };
  }

  const kind = String(data.message_type ?? "");
  if (kind === "status") {
    const percent = data.percent_done === undefined ? null : Math.min(100, num(data.percent_done) * 100);
    return {
      type: "status",
      progress: {
        percent,
        filesDone: num(data.files_done ?? data.files_restored),
        totalFiles: num(data.total_files),
        bytesDone: num(data.bytes_done ?? data.bytes_restored),
        totalBytes: num(data.total_bytes),
        currentFiles: Array.isArray(data.current_files) ? data.current_files.map(String).slice(0, 3) : [],
        secondsRemaining: data.seconds_remaining === undefined ? null : num(data.seconds_remaining),
      },
    };
  }
  if (kind === "summary") {
    return {
      type: "summary",
      summary: {
        snapshotId: String(data.snapshot_id ?? ""),
        filesNew: num(data.files_new),
        filesChanged: num(data.files_changed),
        filesTotal: num(data.total_files_processed ?? data.total_files),
        bytesAdded: num(data.data_added),
        bytesProcessed: num(data.total_bytes_processed ?? data.total_bytes),
      },
    };
  }
  if (kind === "error" || kind === "exit_error") {
    const error = data.error as { message?: unknown } | undefined;
    return {
      type: "error",
      message: String(error?.message ?? data.message ?? trimmed),
      item: String(data.item ?? ""),
    };
  }
  return { type: "text", text: trimmed };
}

/**
 * Çıktının içindeki ilk JSON dizisini/nesnesini ayıklar.
 *
 * restic bazen JSON'un önüne uyarı satırı yazıyor (ör. "repository is already
 * locked"). Ham çıktıyı doğrudan JSON.parse'a vermek bu durumda patlıyor.
 */
export function extractJson(output: string): string | null {
  const start = output.search(/[[{]/);
  if (start < 0) return null;
  const end = Math.max(output.lastIndexOf("]"), output.lastIndexOf("}"));
  return end > start ? output.slice(start, end + 1) : null;
}

export function parseSnapshots(output: string): Snapshot[] {
  const json = extractJson(output);
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item: Record<string, unknown>) => {
      const summary = item.summary as Record<string, unknown> | undefined;
      return {
        id: String(item.id ?? ""),
        shortId: String(item.short_id ?? String(item.id ?? "").slice(0, 8)),
        time: Math.floor(new Date(String(item.time)).getTime() / 1000),
        hostname: String(item.hostname ?? ""),
        paths: Array.isArray(item.paths) ? item.paths.map(String) : [],
        tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
        sizeBytes: summary ? num(summary.total_bytes_processed) : null,
        filesTotal: summary ? num(summary.total_files_processed) : null,
      };
    })
    .filter((snapshot) => snapshot.id.length > 0)
    .sort((a, b) => b.time - a.time);
}

function parentOf(path: string): string {
  const index = path.replace(/\/+$/, "").lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

/** `ls <dir> --json` → yalnızca `dir`'in doğrudan çocukları, önce klasörler. */
export function parseLs(output: string, dir: string): SnapshotEntry[] {
  const base = dir === "/" ? "/" : dir.replace(/\/+$/, "");
  const entries: SnapshotEntry[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let node: Record<string, unknown>;
    try {
      node = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    if ((node.struct_type ?? node.message_type) !== "node") continue;
    const path = String(node.path ?? "");
    if (path === base || parentOf(path) !== base) continue;
    const type = String(node.type ?? "");
    entries.push({
      path,
      name: String(node.name ?? path.split("/").pop() ?? ""),
      type: type === "dir" || type === "file" || type === "symlink" ? type : "other",
      size: num(node.size),
      mtime: node.mtime ? Math.floor(new Date(String(node.mtime)).getTime() / 1000) : null,
    });
  }
  return entries.sort((a, b) =>
    a.type === "dir" && b.type !== "dir"
      ? -1
      : b.type === "dir" && a.type !== "dir"
        ? 1
        : a.name.localeCompare(b.name),
  );
}

/** `diff --json` → değişen yollar + istatistik. Listeler `limit` ile kırpılır. */
export function parseDiff(output: string, limit = 500): SnapshotDiff {
  const diff: SnapshotDiff = { added: [], removed: [], changed: [], addedBytes: 0, removedBytes: 0 };
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (data.message_type === "change") {
      const path = String(data.path ?? "");
      const modifier = String(data.modifier ?? "");
      const bucket = modifier.startsWith("+") ? diff.added : modifier.startsWith("-") ? diff.removed : diff.changed;
      if (bucket.length < limit) bucket.push(path);
    } else if (data.message_type === "statistics") {
      diff.addedBytes = num((data.added as Record<string, unknown> | undefined)?.bytes);
      diff.removedBytes = num((data.removed as Record<string, unknown> | undefined)?.bytes);
    }
  }
  return diff;
}

/** `stats --mode raw-data --json`. */
export function parseStats(output: string): Pick<RepoStats, "storedBytes" | "rawBytes" | "snapshots"> | null {
  const json = extractJson(output);
  if (!json) return null;
  try {
    const data = JSON.parse(json) as Record<string, unknown>;
    const stored = num(data.total_size);
    return {
      storedBytes: stored,
      rawBytes: num(data.total_uncompressed_size) || stored,
      snapshots: num(data.snapshots_count),
    };
  } catch {
    return null;
  }
}

/** `forget --json` → silinen snapshot sayısı. */
export function countRemoved(output: string): number {
  const json = extractJson(output);
  if (!json) return 0;
  try {
    const parsed = JSON.parse(json) as { remove?: unknown[] | null }[];
    return Array.isArray(parsed)
      ? parsed.reduce((total, entry) => total + (entry.remove?.length ?? 0), 0)
      : 0;
  } catch {
    return 0;
  }
}

/** `df -Pk <yol>` → boş/toplam bayt. */
export function parseDf(output: string): { freeBytes: number; totalBytes: number } | null {
  const lines = output.trim().split("\n");
  for (const line of lines.slice(1).reverse()) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 4 && /^\d+$/.test(parts[1]) && /^\d+$/.test(parts[3])) {
      return { totalBytes: Number(parts[1]) * 1024, freeBytes: Number(parts[3]) * 1024 };
    }
  }
  return null;
}

/** Depo henüz oluşturulmamış mı (restic'in "yok" çıktıları)? */
export function looksUninitialized(output: string, exitCode: number): boolean {
  // restic ≥ 0.17: depo yoksa çıkış kodu 10.
  if (exitCode === 10) return true;
  return /does not exist|unable to open config file|Is there a repository at the following location/i.test(output);
}

/** Depo kilitli mi (bayat kilit — "Kilidi aç" önerilir)? */
export function looksLocked(output: string): boolean {
  return /repository is already locked|unable to create lock/i.test(output);
}

/**
 * Anormal boyut: eklenen veri ortalamanın ≥ 5 katı (ve en az 100 MB) ya da
 * toplam dosya sayısı %30'dan fazla düştü.
 */
export function detectAnomaly(
  current: { bytesAdded: number; filesTotal: number },
  history: { bytesAdded: number; filesTotal: number }[],
): { kind: "growth" | "shrink"; ratio: number } | null {
  if (history.length < 3) return null;
  const avgAdded = history.reduce((sum, run) => sum + run.bytesAdded, 0) / history.length;
  if (current.bytesAdded >= 100 * 1024 * 1024 && current.bytesAdded >= avgAdded * 5) {
    return { kind: "growth", ratio: avgAdded > 0 ? current.bytesAdded / avgAdded : Infinity };
  }
  const avgFiles = history.reduce((sum, run) => sum + run.filesTotal, 0) / history.length;
  if (avgFiles >= 20 && current.filesTotal < avgFiles * 0.7) {
    return { kind: "shrink", ratio: current.filesTotal / avgFiles };
  }
  return null;
}

/** Kaynak etiketi/yol bileşeni için güvenli ad. */
export function slug(value: string): string {
  return (
    value
      .replace(/^\/+|\/+$/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .slice(0, 80) || "root"
  );
}
