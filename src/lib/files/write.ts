import "server-only";

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { dataDir } from "@/lib/db/client";
import { panelDataVolume } from "@/lib/host/self";
import { onHost } from "@/lib/hosts/on-host";
import { serverT } from "@/lib/i18n/runtime";
import { getDockerProvider } from "@/lib/providers";
import { getString } from "@/lib/settings";
import { elevatedList, isPermissionError } from "./elevated";
import { checkPath } from "./paths";

/**
 * M3.5 — yazma tarafı.
 *
 * Panel container'ının host'a YAZMA yetkisi YOK: host kökü `/host/root` altına
 * salt-okunur bağlı ve öyle kalıyor. Yazma gerektiren her işlem, yalnızca
 * hedef klasörü yazılabilir olarak bağlayan tek seferlik bir container içinde
 * çalışıyor (M3.4'teki restic ile aynı desen).
 *
 * Bunun bedeli her yazma işleminde ~1 saniyelik container maliyeti. Karşılığı:
 * panel ele geçirilse bile saldırganın elinde host dosya sistemine doğrudan
 * yazan bir process yok, ve her yazma işlemi hangi klasöre dokunacağını
 * ÖNCEDEN beyan etmek zorunda.
 *
 * KABUK KULLANILMIYOR: komutlar dizi olarak veriliyor, hiçbir kullanıcı girdisi
 * bir kabuk tarafından yorumlanmıyor. Dosya adındaki `; rm -rf /` yalnızca
 * tuhaf bir dosya adıdır.
 */

const WORK = "/work";
const STAGING = "/staging";

function image(): string {
  return getString("files.helper_image");
}

export type WriteOutcome = { ok: boolean; message: string };

/**
 * Hedef klasörün GERÇEKTEN var olduğunu doğrular.
 *
 * Sunucuda bulundu: Docker, bind kaynağı yoksa onu SESSİZCE oluşturuyor — ve
 * root'a ait boş bir klasör olarak. Yani yolda bir yazım hatası, hata mesajı
 * yerine çöp bir dizin üretiyordu. Bind vermeden önce klasörün varlığını
 * sormak bunun tek çaresi.
 */
async function parentExists(parentHostPath: string): Promise<boolean> {
  const check = checkPath(parentHostPath);
  if (!check.ok) return false;

  try {
    return (await stat(check.containerPath)).isDirectory();
  } catch (error) {
    // Panel kullanıcısı göremiyorsa root container'a sor.
    if (!isPermissionError(error)) return false;
    const listing = await elevatedList(check.containerPath, 1);
    return !("error" in listing);
  }
}

async function runInParent(
  parentHostPath: string,
  cmd: string[],
  extraBinds: string[] = [],
): Promise<WriteOutcome> {
  if (!(await parentExists(parentHostPath))) {
    return {
      ok: false,
      message: serverT("fileWrite.parentMissing", { path: parentHostPath }),
    };
  }

  const result = await getDockerProvider().runThrowaway({
    image: image(),
    cmd,
    binds: [`${parentHostPath}:${WORK}`, ...extraBinds],
    env: {},
    namePrefix: "panel-files",
    timeoutMs: 120_000,
  });

  return {
    ok: result.exitCode === 0,
    message:
      result.exitCode === 0
        ? serverT("docker.installer.ok")
        : result.output.slice(0, 500) || serverT("fileWrite.commandFailed"),
  };
}

/** Hedefin kendisini ve üst klasörünü doğrular; ikisi de izinli olmalı. */
function resolveTarget(rawPath: string): { parent: string; name: string } | { error: string } {
  const check = checkPath(rawPath);
  if (!check.ok) return { error: check.error };
  if (check.hostPath === "/") return { error: serverT("fileWrite.rootForbidden") };

  const parent = path.posix.dirname(check.hostPath);
  const parentCheck = checkPath(parent);
  if (!parentCheck.ok) return { error: parentCheck.error };

  return { parent, name: path.posix.basename(check.hostPath) };
}

export async function localCreateDirectory(rawPath: string): Promise<WriteOutcome> {
  const target = resolveTarget(rawPath);
  if ("error" in target) return { ok: false, message: target.error };

  return runInParent(target.parent, ["mkdir", "-p", path.posix.join(WORK, target.name)]);
}

export async function localRemoveEntry(rawPath: string, recursive: boolean): Promise<WriteOutcome> {
  const target = resolveTarget(rawPath);
  if ("error" in target) return { ok: false, message: target.error };

  // `-r` yalnızca çağıran açıkça istediğinde: bir klasörü yanlışlıkla silmek
  // tek tıkla geri alınamaz.
  const args = recursive ? ["rm", "-rf"] : ["rm", "-f"];
  return runInParent(target.parent, [...args, path.posix.join(WORK, target.name)]);
}

export async function localRenameEntry(rawPath: string, newName: string): Promise<WriteOutcome> {
  const target = resolveTarget(rawPath);
  if ("error" in target) return { ok: false, message: target.error };

  const clean = newName.trim();
  if (clean.length === 0) return { ok: false, message: serverT("fileWrite.nameEmpty") };
  // Yeni ad bir YOL değil, bir AD. `/` ya da `..` içeren bir "ad", dosyayı
  // izinli kökün dışına taşımanın yolu olurdu.
  if (clean.includes("/") || clean === "." || clean === "..") {
    return { ok: false, message: serverT("fileWrite.nameSlash") };
  }

  return runInParent(target.parent, [
    "mv",
    path.posix.join(WORK, target.name),
    path.posix.join(WORK, clean),
  ]);
}

export async function localChangeMode(rawPath: string, mode: string): Promise<WriteOutcome> {
  const target = resolveTarget(rawPath);
  if ("error" in target) return { ok: false, message: target.error };

  const clean = mode.trim();
  if (!/^[0-7]{3,4}$/.test(clean)) {
    return { ok: false, message: serverT("fileWrite.modeOctal") };
  }

  return runInParent(target.parent, ["chmod", clean, path.posix.join(WORK, target.name)]);
}

/**
 * Bir klasördeki birçok dosyayı TEK container'da siler (M3.5 temizlik
 * asistanı). Dosya başına container açmak, yüzlerce döndürülmüş log için
 * dakikalar sürerdi.
 *
 * `names` yalnızca dosya ADI — çağıran taraf yolu zaten doğrulamış olmalı.
 * Buradaki `/` kontrolü ikinci savunma hattı: bir hata dosya adı yerine yol
 * geçirirse işlem hedef klasörün dışına çıkamasın.
 */
export async function removeFilesIn(
  parentHostPath: string,
  names: string[],
): Promise<WriteOutcome> {
  const check = checkPath(parentHostPath);
  if (!check.ok) return { ok: false, message: check.error };
  if (names.length === 0) return { ok: true, message: serverT("fileWrite.nothingToDelete") };

  const clean = names.filter((name) => !name.includes("/") && name !== "." && name !== "..");
  if (clean.length !== names.length) {
    return { ok: false, message: serverT("fileWrite.invalidName") };
  }

  // `rm -f --` : sonrasındaki her şey dosya adı, bayrak değil. "-rf" adlı bir
  // dosya aksi halde komutun kendi bayrağı sanılırdı.
  return runInParent(check.hostPath, [
    "rm",
    "-f",
    "--",
    ...clean.map((name) => path.posix.join(WORK, name)),
  ]);
}

/**
 * Dosya içeriği yazar (düzenleme ve yükleme aynı yolu kullanır).
 *
 * İçerik önce panelin KENDİ veri dizinine yazılıyor (oraya yazma yetkisi var),
 * sonra o volume geçici container'a salt-okunur bağlanıp hedefe kopyalanıyor.
 * Ara dosya her durumda siliniyor.
 */
export async function localWriteFile(
  rawPath: string,
  content: Buffer,
): Promise<WriteOutcome> {
  const target = resolveTarget(rawPath);
  if ("error" in target) return { ok: false, message: target.error };

  const volume = await panelDataVolume();
  if (!volume) {
    return {
      ok: false,
      message: serverT("fileWrite.noPanelVolume"),
    };
  }

  const stagingDir = path.join(dataDir(), "staging");
  mkdirSync(stagingDir, { recursive: true });

  const tempName = `upload-${randomBytes(8).toString("hex")}`;
  const tempPath = path.join(stagingDir, tempName);

  try {
    writeFileSync(tempPath, content);

    return await runInParent(
      target.parent,
      [
        "cp",
        path.posix.join(STAGING, "staging", tempName),
        path.posix.join(WORK, target.name),
      ],
      [`${volume}:${STAGING}:ro`],
    );
  } finally {
    rmSync(tempPath, { force: true });
  }
}

// --- Çoklu sunucu -------------------------------------------------------------
//
// Yazma işlemleri seçili sunucuda yapılır: uzak sunucuda iş (geçici container
// ve ara dosya dahil) o sunucunun ajanına yaptırılır — ara dosya merkezin veri
// volume'ünde dururken uzak sunucudaki container onu göremezdi.

export function createDirectory(rawPath: string): Promise<WriteOutcome> {
  return onHost("files.mkdir", [rawPath], () => localCreateDirectory(rawPath));
}

export function removeEntry(rawPath: string, recursive: boolean): Promise<WriteOutcome> {
  return onHost("files.remove", [rawPath, recursive], () => localRemoveEntry(rawPath, recursive));
}

export function renameEntry(rawPath: string, newName: string): Promise<WriteOutcome> {
  return onHost("files.rename", [rawPath, newName], () => localRenameEntry(rawPath, newName));
}

export function changeMode(rawPath: string, mode: string): Promise<WriteOutcome> {
  return onHost("files.chmod", [rawPath, mode], () => localChangeMode(rawPath, mode));
}

export function writeFile(rawPath: string, content: Buffer): Promise<WriteOutcome> {
  return onHost("files.write", [rawPath, content], () => localWriteFile(rawPath, content));
}
