import "server-only";

import { createReadStream } from "node:fs";
import { lstat, readdir, readFile, readlink, stat } from "node:fs/promises";
import path from "node:path";

import { getNumber } from "@/lib/settings";
import { elevatedList, elevatedRead, elevatedUsage, isPermissionError } from "./elevated";
import { checkPath, contentReadable } from "./paths";

/** M3.5 — okuma tarafı. Host kökünün salt-okunur bağından doğrudan okunur. */

export type FileEntry = {
  name: string;
  path: string;
  kind: "file" | "dir" | "symlink" | "other";
  sizeBytes: number;
  modifiedAt: number;
  /** rwxr-xr-x biçiminde. */
  modeText: string;
  /** 0644 biçiminde — chmod alanına doğrudan yazılabilsin. */
  modeOctal: string;
  uid: number;
  gid: number;
  /** Sembolik bağın hedefi; değilse null. */
  linkTarget: string | null;
};

export type Listing = {
  path: string;
  parent: string | null;
  entries: FileEntry[];
  /** Klasörde bundan fazla girdi varsa kesildi. */
  truncated: boolean;
  totalEntries: number;
};

function modeToText(mode: number): string {
  const bits = "rwxrwxrwx";
  let out = "";
  for (let i = 0; i < 9; i += 1) {
    out += mode & (1 << (8 - i)) ? bits[i] : "-";
  }
  return out;
}

const MAX_ENTRIES = 2000;

export async function listDirectory(rawPath: string): Promise<Listing> {
  const check = checkPath(rawPath);
  if (!check.ok) throw new Error(check.error);

  let dirents;
  try {
    dirents = await readdir(check.containerPath, { withFileTypes: true });
  } catch (error) {
    // Panel yetkisiz bir kullanıcı olarak çalışıyor; 750 izinli bir ev dizinini
    // doğrudan okuyamaz. Yalnızca bu durumda root container'a düşülüyor —
    // dünyaya açık yollar hızlı yoldan okunmaya devam ediyor.
    if (!isPermissionError(error)) throw error;
    return listViaContainer(check.hostPath, check.containerPath);
  }

  const total = dirents.length;

  // Klasörler önce, sonra ad sırası: 40 bin dosyalı bir klasörde aradığın
  // alt klasörü bulmak aksi halde imkânsız.
  const sorted = dirents
    .sort((a, b) => {
      const aDir = a.isDirectory() ? 0 : 1;
      const bDir = b.isDirectory() ? 0 : 1;
      return aDir - bDir || a.name.localeCompare(b.name, "tr");
    })
    .slice(0, MAX_ENTRIES);

  const entries: FileEntry[] = [];
  for (const dirent of sorted) {
    const full = path.posix.join(check.containerPath, dirent.name);
    // lstat: sembolik bağın kendisini görmek istiyoruz, gösterdiği şeyi değil.
    // Kırık bir bağ stat ile hata verir ve tüm listeyi düşürürdü.
    const info = await lstat(full).catch(() => null);
    if (!info) continue;

    let linkTarget: string | null = null;
    if (info.isSymbolicLink()) {
      linkTarget = await readlink(full).catch(() => null);
    }

    entries.push({
      name: dirent.name,
      path: path.posix.join(check.hostPath, dirent.name),
      kind: info.isDirectory()
        ? "dir"
        : info.isSymbolicLink()
          ? "symlink"
          : info.isFile()
            ? "file"
            : "other",
      sizeBytes: info.size,
      modifiedAt: Math.floor(info.mtimeMs / 1000),
      modeText: modeToText(info.mode),
      modeOctal: (info.mode & 0o7777).toString(8).padStart(4, "0"),
      uid: info.uid,
      gid: info.gid,
      linkTarget,
    });
  }

  const parent = check.hostPath === "/" ? null : path.posix.dirname(check.hostPath);

  return {
    path: check.hostPath,
    parent,
    entries,
    truncated: total > MAX_ENTRIES,
    totalEntries: total,
  };
}

/** Doğrudan okuma izin hatası verdiğinde root container'dan listeler. */
async function listViaContainer(hostPath: string, containerPath: string): Promise<Listing> {
  const result = await elevatedList(containerPath, MAX_ENTRIES);
  if ("error" in result) throw new Error(result.error);

  const entries: FileEntry[] = result.entries
    .sort((a, b) => {
      const aDir = a.kind === "dir" ? 0 : 1;
      const bDir = b.kind === "dir" ? 0 : 1;
      return aDir - bDir || a.name.localeCompare(b.name, "tr");
    })
    .map((entry) => ({
      name: entry.name,
      path: path.posix.join(hostPath, entry.name),
      kind: entry.kind,
      sizeBytes: entry.sizeBytes,
      modifiedAt: entry.modifiedAt,
      modeText: modeToText(entry.mode),
      modeOctal: (entry.mode & 0o7777).toString(8).padStart(4, "0"),
      uid: entry.uid,
      gid: entry.gid,
      linkTarget: entry.linkTarget,
    }));

  return {
    path: hostPath,
    parent: hostPath === "/" ? null : path.posix.dirname(hostPath),
    entries,
    truncated: result.total > MAX_ENTRIES,
    totalEntries: result.total,
  };
}

export type FileContent = {
  path: string;
  content: string;
  sizeBytes: number;
  truncated: boolean;
  /** İkili dosya tespit edildiyse içerik gönderilmez. */
  binary: boolean;
};

/**
 * Metin önizleme/düzenleme için okur.
 *
 * İkili dosya tespiti: ilk 8 KB içinde NUL baytı varsa ikili sayılır. Kusursuz
 * değil ama pratik — bir PNG'yi metin editörüne açıp kaydetmek dosyayı bozardı.
 */
export async function readTextFile(rawPath: string): Promise<FileContent> {
  const check = checkPath(rawPath);
  if (!check.ok) throw new Error(check.error);

  if (!contentReadable(check.hostPath)) {
    throw new Error(
      "Bu dosyanın içeriği panelden okunamaz (sistem sırrı: parola özeti, sudo kuralı ya da özel anahtar).",
    );
  }

  const maxBytes = getNumber("files.max_edit_kb") * 1024;

  let buffer: Buffer;
  let sizeBytes: number;

  try {
    const info = await stat(check.containerPath);
    if (!info.isFile()) throw new Error("Bu bir dosya değil.");
    buffer = await readFile(check.containerPath);
    sizeBytes = info.size;
  } catch (error) {
    if (!isPermissionError(error)) throw error;
    // Yükseltilmiş okuma zaten kesiyor; boyut ayrıca dönüyor.
    const result = await elevatedRead(check.containerPath, maxBytes);
    if ("error" in result) throw new Error(result.error);
    buffer = result.buffer;
    sizeBytes = result.sizeBytes;
  }

  // İlk 8 KB'de NUL varsa ikili sayılır. Kusursuz değil ama pratik: bir PNG'yi
  // metin editöründe açıp kaydetmek dosyayı bozardı.
  if (buffer.subarray(0, 8192).includes(0)) {
    return { path: check.hostPath, content: "", sizeBytes, truncated: false, binary: true };
  }

  return {
    path: check.hostPath,
    content: buffer.subarray(0, maxBytes).toString("utf8"),
    sizeBytes,
    truncated: sizeBytes > maxBytes,
    binary: false,
  };
}

/** İndirme için akış — büyük dosyalar belleğe alınmadan geçsin. */
export async function openForDownload(
  rawPath: string,
): Promise<{ stream: ReadableStream; name: string; sizeBytes: number }> {
  const check = checkPath(rawPath);
  if (!check.ok) throw new Error(check.error);

  if (!contentReadable(check.hostPath)) {
    throw new Error("Bu dosya panelden indirilemez (sistem sırrı).");
  }

  let info;
  try {
    info = await stat(check.containerPath);
  } catch (error) {
    if (!isPermissionError(error)) throw error;

    /*
      Root'a ait dosya: doğrudan akıtılamıyor. Yükseltilmiş okuma dosyayı
      belleğe alarak getiriyor, bu yüzden bir üst sınır var — sınırsız olsaydı
      500 MB'lık bir log dosyası paneli düşürürdü. Sınırın üstündekiler için
      dürüst bir hata veriliyor, yarım dosya değil.
    */
    const limit = getNumber("files.max_download_mb") * 1024 * 1024;
    const result = await elevatedRead(check.containerPath, limit);
    if ("error" in result) throw new Error(result.error);

    if (result.sizeBytes > limit) {
      throw new Error(
        `Bu dosya ${Math.round(result.sizeBytes / 1024 / 1024)} MB ve yükseltilmiş okuma ` +
          `sınırı ${getNumber("files.max_download_mb")} MB. Ayarlardan sınırı artırabilirsin.`,
      );
    }

    const buffer = result.buffer;
    return {
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(buffer));
          controller.close();
        },
      }),
      name: path.posix.basename(check.hostPath),
      sizeBytes: buffer.length,
    };
  }

  if (!info.isFile()) throw new Error("Yalnızca dosya indirilebilir.");

  // Node akışını Web akışına çevirir — Response gövdesi olarak verilebilsin
  // ve büyük dosya belleğe alınmadan geçsin.
  const nodeStream = createReadStream(check.containerPath);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on("data", (chunk) => controller.enqueue(new Uint8Array(chunk as Buffer)));
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", (error) => controller.error(error));
    },
    cancel() {
      nodeStream.destroy();
    },
  });

  return {
    stream,
    name: path.posix.basename(check.hostPath),
    sizeBytes: info.size,
  };
}

export type UsageEntry = { path: string; name: string; bytes: number; isDir: boolean };

/**
 * Disk kullanım analizi: bir klasörün alt öğelerini boyuta göre sıralar.
 *
 * `du` gibi ÖZYİNELEMELİ toplar ama bir süre ve derinlik sınırı var. Sınırsız
 * bir tarama `/` üzerinde dakikalarca sürer ve panelin olay döngüsünü işgal
 * eder; kullanıcı "hangi klasör şişmiş" sorusunun cevabını saniyeler içinde
 * istiyor, tam bir envanter değil.
 */
export async function analyzeUsage(
  rawPath: string,
): Promise<{ path: string; entries: UsageEntry[]; totalBytes: number; timedOut: boolean }> {
  const check = checkPath(rawPath);
  if (!check.ok) throw new Error(check.error);

  const deadline = Date.now() + getNumber("files.scan_timeout_seconds") * 1000;
  let timedOut = false;

  async function sizeOf(target: string, depth: number): Promise<number> {
    if (Date.now() > deadline) {
      timedOut = true;
      return 0;
    }

    const info = await lstat(target).catch(() => null);
    if (!info) return 0;
    // Sembolik bağlar takip edilmiyor: /var/lib → /mnt gibi bir bağ aynı
    // baytları iki kez sayar, döngü varsa hiç bitmez.
    if (info.isSymbolicLink()) return 0;
    if (!info.isDirectory()) return info.size;
    if (depth > 12) return 0;

    const children = await readdir(target).catch(() => []);
    let total = 0;
    for (const child of children) {
      total += await sizeOf(path.posix.join(target, child), depth + 1);
      if (Date.now() > deadline) {
        timedOut = true;
        break;
      }
    }
    return total;
  }

  let dirents;
  try {
    dirents = await readdir(check.containerPath, { withFileTypes: true });
  } catch (error) {
    if (!isPermissionError(error)) throw error;

    const elevated = await elevatedUsage(
      check.containerPath,
      getNumber("files.scan_timeout_seconds") * 1000,
    );
    if ("error" in elevated) throw new Error(elevated.error);

    const rows = elevated.entries
      .map((entry) => ({
        path: path.posix.join(check.hostPath, entry.name),
        name: entry.name,
        bytes: entry.bytes,
        isDir: entry.isDir,
      }))
      .sort((a, b) => b.bytes - a.bytes);

    return {
      path: check.hostPath,
      entries: rows.slice(0, 100),
      totalBytes: rows.reduce((sum, entry) => sum + entry.bytes, 0),
      timedOut: elevated.timedOut,
    };
  }

  const entries: UsageEntry[] = [];

  for (const dirent of dirents) {
    const full = path.posix.join(check.containerPath, dirent.name);
    entries.push({
      path: path.posix.join(check.hostPath, dirent.name),
      name: dirent.name,
      bytes: await sizeOf(full, 0),
      isDir: dirent.isDirectory(),
    });
    if (Date.now() > deadline) {
      timedOut = true;
      break;
    }
  }

  entries.sort((a, b) => b.bytes - a.bytes);

  return {
    path: check.hostPath,
    entries: entries.slice(0, 100),
    totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    timedOut,
  };
}
