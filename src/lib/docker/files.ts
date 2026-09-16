import "server-only";

import path from "node:path";

import { audit } from "@/lib/auth/audit";
import { serverT } from "@/lib/i18n/runtime";
import { getDockerProvider } from "@/lib/providers";
import { getNumber } from "@/lib/settings";

import { looksLikeMissingLs, normalizePath, parseListing, type FileEntry } from "./listing.ts";
import { readTar, writeTar, type TarEntry } from "./tar.ts";

/**
 * Container içi dosya tarayıcı — I/O katmanı (M3.23).
 *
 * ⚠️ BU MODÜL ROOT'A EŞDEĞER GÜÇ VERİYOR. Bir container'ın dosyasını
 * değiştirmek, o uygulamayı ele geçirmekle aynı şey: yapılandırmasını,
 * betiklerini, hatta çalıştırdığı ikili dosyayı değiştirebilirsin. Bu yüzden
 * yazma yolu `docker.action` istiyor, her yazma denetim kaydına giriyor ve
 * boyut sınırlı.
 *
 * Panelin host dosya yöneticisi (M3.5) host'un dosyalarını geziyordu;
 * container'ın İÇİ ona kapalıydı. Bir uygulamanın yapılandırmasını düzeltmenin
 * tek yolu terminale girip `vi` ile uğraşmaktı.
 *
 * LİSTELEME NEDEN `ls` İLE: Docker'ın arşiv ucu bir dizin istendiğinde onun
 * tüm içeriğini ÖZYİNELEMELİ tar'layıp gönderiyor — `/` için bu, tüm dosya
 * sistemini panele indirmek demek. `ls -la` tek seviye veriyor ve ucuz. Bedeli:
 * `ls` olmayan imajlarda çalışmıyor; o durumda sebebini yazıyoruz.
 */

export type { FileEntry };

export type ListResult =
  | { ok: true; entries: FileEntry[]; path: string }
  | { ok: false; error: string; path: string };

export async function listContainerPath(id: string, input: string): Promise<ListResult> {
  const directory = normalizePath(input);

  let result;
  try {
    // `--` sonrası: adı tire ile başlayan bir dizin, seçenek sanılmasın.
    result = await getDockerProvider().runOnce(id, ["ls", "-la", "--", directory]);
  } catch (error) {
    return {
      ok: false,
      path: directory,
      error: error instanceof Error ? error.message : serverT("containerFiles.execFailed"),
    };
  }

  if (result.exitCode !== 0) {
    const output = result.output.trim();

    if (looksLikeMissingLs(output)) {
      return {
        ok: false,
        path: directory,
        error:
          serverT("containerFiles.noLs"),
      };
    }

    return { ok: false, path: directory, error: output || serverT("containerFiles.dirUnreadable") };
  }

  return { ok: true, path: directory, entries: parseListing(result.output, directory) };
}

/** Okuma ve yerinde düzenleme için üst sınır (ayar: `docker.file_max_kb`). */
export function maxFileBytes(): number {
  return getNumber("docker.file_max_kb") * 1024;
}

export type ReadResult = { ok: true; entry: TarEntry } | { ok: false; error: string };

/**
 * Container içinden TEK bir dosya okur.
 *
 * Arşivin ilk DOSYA girdisi alınıyor. Dizin verilirse Docker özyinelemeli bir
 * arşiv gönderiyor; onu "indirme" diye kullanıcıya sunmak, `/` yazan birine
 * gigabaytlarca veri indirtmek olurdu — bu yüzden dizinde açıkça hata veriyoruz.
 */
export async function readContainerFile(id: string, input: string): Promise<ReadResult> {
  const target = normalizePath(input);

  let archive: Buffer;
  try {
    archive = await getDockerProvider().readContainerArchive(id, target);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : serverT("containerFiles.fileUnreadable"),
    };
  }

  const entries = readTar(archive);
  const file = entries.find((entry) => entry.type === "dosya");

  if (!file) {
    return {
      ok: false,
      error:
        entries.length > 0
          ? serverT("containerFiles.isDirectory", { path: target })
          : serverT("containerFiles.notFound", { path: target }),
    };
  }

  return { ok: true, entry: file };
}

export type WriteResult = { ok: boolean; error?: string };

/**
 * Container içine dosya yazar.
 *
 * Denetim kaydı BURADA yazılıyor, çağıranda değil: bu fonksiyonun her çağrısı
 * bir uygulamanın davranışını değiştirebilir ve kaydın atlanabileceği bir
 * çağrı yolu bırakılmamalı.
 */
export async function writeContainerFile(
  id: string,
  input: string,
  data: Buffer,
  actor: { username: string; userId: number },
  containerName: string,
): Promise<WriteResult> {
  const target = normalizePath(input);
  if (target === "/") return { ok: false, error: serverT("containerFiles.rootWrite") };

  const limit = maxFileBytes();
  if (data.length > limit) {
    return {
      ok: false,
      error: serverT("containerFiles.tooLarge", {
        limit: Math.round(limit / 1024),
        size: data.length,
      }),
    };
  }

  const directory = path.posix.dirname(target);
  const name = path.posix.basename(target);

  const kaydet = (result: "ok" | "error", detail: string) =>
    audit({
      userId: actor.userId,
      username: actor.username,
      action: "docker.file_write",
      targetType: "container",
      targetId: containerName,
      detail,
      result,
    });

  try {
    // Arşivdeki yol hedef dizine GÖRELİ olmalı; mutlak yol verilince Docker
    // arşivi reddediyor.
    await getDockerProvider().writeContainerArchive(id, directory, writeTar([{ name, data }]));
  } catch (error) {
    const message = error instanceof Error ? error.message : serverT("containerFiles.writeFailed");
    kaydet(
      "error",
      serverT("containerFiles.auditBytes", { path: target, size: data.length, message }),
    );
    return { ok: false, error: message };
  }

  kaydet("ok", `${target} (${data.length} bayt)`);
  return { ok: true };
}
