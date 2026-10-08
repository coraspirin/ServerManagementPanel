import "server-only";

import { isSystemBind } from "@/lib/backup/discover";
import { panelContainerName, panelImage } from "@/lib/host/self";
import { serverT } from "@/lib/i18n/runtime";
import { getDockerProvider } from "@/lib/providers";

/**
 * Container'ların verisindeki SQLite dosyaları.
 *
 * Kendi uygulamaların çoğu (Defterim, Vaultwarden, Uptime Kuma, Pi-hole…)
 * ayrı bir DB sunucusu değil, volume ya da bind içindeki bir SQLite dosyası
 * kullanıyor; sunucu taraması bunları göremez. Burada her container'ın
 * bağlı dizinleri taranır ve dosya ADINA değil İÇERİĞİNE bakılır: ilk 15
 * bayt "SQLite format 3" değilse `.db` uzantısı yetmez.
 *
 * Volume'ler `/var/lib/docker` altında ve panel kullanıcısı oraya giremiyor;
 * tarama panel imajından root bir geçici container'da yapılır (SQLite
 * sürücüsünün yükseltilmiş okuması gibi). Uzak sunucuda sağlayıcı bunu
 * oradaki ajana yaptırır.
 */

export type SqliteFile = {
  /** Host üzerindeki yol — SQLite sürücüsü bununla açıyor. */
  hostPath: string;
  /** Container içindeki yol — kullanıcının tanıdığı ad. */
  containerPath: string;
  container: string;
  sizeBytes: number;
};

type Mount = { source: string; destination: string; container: string };

/** Yedek, önbellek ve kopyalar: veri değil, listede gürültü. */
const NOISE = /\/(backups?|cache|caches|snapshots?|tmp)\/|trivy|[._-](old|bak|backup)\.(db|sqlite3?)$/i;

const SCRIPT = [
  'printf "%s\\n" "$DIRS" | while IFS= read -r d; do',
  '  [ -n "$d" ] || continue',
  '  find "/host/root$d" -xdev -maxdepth 6 -type f \\( -name "*.db" -o -name "*.sqlite" -o -name "*.sqlite3" -o -name "*.db3" \\) -size +0c 2>/dev/null',
  "done | sort -u | while IFS= read -r f; do",
  '  [ "$(head -c 15 "$f" 2>/dev/null)" = "SQLite format 3" ] && printf "%s\\t%s\\n" "$(stat -c %s "$f")" "${f#/host/root}"',
  "done",
].join("\n");

async function containerMounts(): Promise<Mount[]> {
  const provider = getDockerProvider();
  const mounts: Mount[] = [];
  for (const container of await provider.list(true)) {
    if (container.name === panelContainerName()) continue;
    type Raw = { Mounts?: { Type?: string; Source?: string; Destination?: string }[] } | null;
    let raw: Raw;
    try {
      raw = (await provider.inspectRaw(container.id)) as Raw;
    } catch {
      continue;
    }
    // Ajan/panel kopyası: host kökünü bağlayan container'ın "verisi" tüm disk.
    if (raw?.Mounts?.some((mount) => mount.Destination === "/host/root")) continue;
    for (const mount of raw?.Mounts ?? []) {
      const source = String(mount.Source ?? "");
      if ((mount.Type !== "volume" && mount.Type !== "bind") || !source.startsWith("/")) continue;
      if (mount.Type === "bind" && isSystemBind(source)) continue;
      mounts.push({ source, destination: String(mount.Destination ?? ""), container: container.name });
    }
  }
  return mounts;
}

/** Dosyanın sahibi: kaynağı dosyayı en dar kapsayan bağlantı. */
function owner(mounts: Mount[], file: string): Mount | null {
  let best: Mount | null = null;
  for (const mount of mounts) {
    const prefix = mount.source.endsWith("/") ? mount.source : `${mount.source}/`;
    if (file !== mount.source && !file.startsWith(prefix)) continue;
    if (!best || mount.source.length > best.source.length) best = mount;
  }
  return best;
}

export async function scanSqliteFiles(): Promise<SqliteFile[]> {
  const mounts = await containerMounts();
  if (mounts.length === 0) return [];

  const image = await panelImage();
  if (!image) throw new Error(serverT("dbadmin.native.noImage"));

  const directories = [...new Set(mounts.map((mount) => mount.source))];
  const result = await getDockerProvider().runThrowaway({
    image,
    entrypoint: ["sh", "-c", SCRIPT],
    cmd: [],
    binds: ["/:/host/root:ro"],
    env: { DIRS: directories.join("\n") },
    namePrefix: "panel-sqlite-scan",
    timeoutMs: 120_000,
    user: "0:0",
    networkMode: "none",
  });
  if (result.exitCode !== 0) {
    throw new Error((result.stderr || result.output).slice(0, 300) || serverT("dbadmin.execFailed", { code: result.exitCode }));
  }

  const files: SqliteFile[] = [];
  for (const line of (result.stdout ?? result.output).split("\n")) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const hostPath = line.slice(tab + 1).trim();
    if (!hostPath || NOISE.test(hostPath)) continue;
    const mount = owner(mounts, hostPath);
    if (!mount) continue;
    files.push({
      hostPath,
      containerPath: `${mount.destination.replace(/\/$/, "")}${hostPath.slice(mount.source.replace(/\/$/, "").length)}`,
      container: mount.container,
      sizeBytes: Number(line.slice(0, tab)) || 0,
    });
  }
  return files;
}
