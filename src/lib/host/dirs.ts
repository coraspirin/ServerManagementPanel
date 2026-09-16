import "server-only";
import { serverT } from "@/lib/i18n/runtime";

import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

import { elevatedList, isPermissionError } from "@/lib/files/elevated";
import { forbiddenPath, hostRoot } from "@/lib/files/paths";

/**
 * Ayarlardaki dizin seçici için host klasör listesi (M3.45).
 *
 * ## Neden `files/browse.ts` kullanılmıyor
 *
 * O modülün her okuması `checkPath`ten geçiyor ve `checkPath` yolu
 * `files.roots` ayarıyla sınırlıyor. Oysa buradaki seçicinin YAPILANDIRDIĞI
 * ayarlardan biri tam olarak o liste: izinli kökleri seçerken izinli köklerin
 * dışına çıkamamak, ayarı hiç değiştirememek demek. Yığın kök dizini de
 * (`/opt/stacks`) varsayılan köklerin dışında olabiliyor.
 *
 * Bu yüzden kök kısıtı burada YOK; yerine üç sınır var:
 *
 * 1. `/proc`, `/sys`, `/dev`, `/run` yine yasak (`forbiddenPath`).
 * 2. Yalnızca KLASÖRLER dönüyor — dosya adları, dolayısıyla dosya içerikleri
 *    hakkında bir bilgi sızmıyor.
 * 3. Uç nokta `settings.edit` izniyle korunuyor: ayarı değiştirebilen zaten
 *    izinli kök listesini istediği gibi yazabiliyordu.
 */

export type DirEntry = { name: string; path: string };

export type DirListing = {
  path: string;
  parent: string | null;
  dirs: DirEntry[];
  /** Bu klasörün kendisi okunamadıysa sebebi. */
  error: string | null;
};

/** Aynı anda dönen en fazla klasör; `/nix/store` gibi yerler için tavan. */
const MAX_DIRS = 1000;

function normalize(raw: string): string {
  const input = (raw || "/").trim();
  if (!input.startsWith("/")) return "/";
  return path.posix.normalize(input).replace(/\/+$/, "") || "/";
}

export async function listHostDirs(rawPath: string): Promise<DirListing> {
  const hostPath = normalize(rawPath);
  const parent = hostPath === "/" ? null : path.posix.dirname(hostPath);

  if (hostPath.includes("\0") || forbiddenPath(hostPath)) {
    return { path: hostPath, parent, dirs: [], error: serverT("dirs.forbidden") };
  }

  const containerPath = path.posix.join(hostRoot(), hostPath);

  let names: string[];
  try {
    const dirents = await readdir(containerPath, { withFileTypes: true });
    names = dirents.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (!isPermissionError(error)) {
      const message = error instanceof Error ? error.message : "";
      return {
        path: hostPath,
        parent,
        dirs: [],
        error: message.includes("ENOENT")
          ? serverT("dirs.notFound")
          : message.includes("ENOTDIR")
            ? serverT("dirs.notDir")
            : serverT("dirs.unreadable"),
      };
    }

    // 750 izinli ev dizinleri: panel yetkisiz kullanıcı olarak çalışıyor ve
    // doğrudan okuyamıyor. Dosya yöneticisiyle aynı geçici root container'a
    // düşülüyor — yeni bir yetki yolu açılmıyor.
    const result = await elevatedList(containerPath, MAX_DIRS);
    if ("error" in result) {
      return { path: hostPath, parent, dirs: [], error: result.error };
    }
    names = result.entries.filter((entry) => entry.kind === "dir").map((entry) => entry.name);
  }

  const dirs = names
    .map((name) => ({ name, path: path.posix.join(hostPath, name) }))
    .filter((entry) => !forbiddenPath(entry.path))
    .sort((a, b) => a.name.localeCompare(b.name, "tr"))
    .slice(0, MAX_DIRS);

  return { path: hostPath, parent, dirs, error: null };
}

/** Yolun gerçekten var olan bir klasör olup olmadığı — seçim onayı için. */
export async function hostDirExists(rawPath: string): Promise<boolean> {
  const hostPath = normalize(rawPath);
  if (forbiddenPath(hostPath)) return false;

  const info = await lstat(path.posix.join(hostRoot(), hostPath)).catch(() => null);
  return info?.isDirectory() ?? false;
}
