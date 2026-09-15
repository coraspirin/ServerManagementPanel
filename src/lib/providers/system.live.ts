import os from "node:os";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SystemInfo, SystemProvider } from "./types";

/**
 * Container içinden HOST bilgisi okumak.
 *
 * `os.hostname()` container'ın UTS namespace'ini görür ve container kimliğini
 * (ör. "f3394a8a8677") döndürür — panelin göstermesi gereken sunucu adını
 * değil. Bu yüzden host'tan mount edilen dosyalar önceliklidir.
 *
 * CPU/bellek/uptime için `node:os` zaten host değerlerini verir (/proc
 * namespace'lenmediği sürece), o yüzden onlar olduğu gibi kullanılır.
 */
const HOST_ROOT = process.env.HOST_ROOT ?? "/host";

async function readHostFile(relativePath: string): Promise<string | null> {
  try {
    const content = await readFile(path.join(HOST_ROOT, relativePath), "utf8");
    return content.trim() || null;
  } catch {
    return null;
  }
}

/** /etc/os-release içinden PRETTY_NAME — çekirdek sürümünden çok daha okunur. */
function parsePrettyName(osRelease: string): string | null {
  const match = osRelease.match(/^PRETTY_NAME="?(.+?)"?$/m);
  return match?.[1] ?? null;
}

export const liveSystemProvider: SystemProvider = {
  async info(): Promise<SystemInfo> {
    const cpus = os.cpus();

    const [hostHostname, osRelease] = await Promise.all([
      readHostFile("etc/hostname"),
      readHostFile("etc/os-release"),
    ]);

    return {
      hostname: hostHostname ?? os.hostname(),
      platform: os.platform(),
      release: os.release(),
      osName: osRelease ? parsePrettyName(osRelease) : null,
      arch: os.arch(),
      cpuModel: cpus[0]?.model.trim() ?? "bilinmiyor",
      cpuCount: cpus.length,
      totalMemBytes: os.totalmem(),
      uptimeSeconds: Math.round(os.uptime()),
    };
  },
};
