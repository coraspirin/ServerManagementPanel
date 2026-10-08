import "server-only";

import { getDockerProvider } from "@/lib/providers";
import type { ExecResult, ThrowawaySpec } from "@/lib/providers/types";
import { getNumber, getString } from "@/lib/settings";
import { mountVolumeOptions, parseDf, REPO_MOUNT, repositoryUrl } from "./restic";
import type { RepoSecrets } from "./store/repos";

/**
 * restic'i çalıştırma katmanı.
 *
 * restic HOST'A KURULMUYOR. Her komut, tek seferlik bir container içinde
 * çalışıyor: sürüm imajla sabit, host-helper izin listesine satır gerekmiyor,
 * kaynaklar container'a salt-okunur bağlanıyor. Uzak sunucuda aynı çağrılar
 * ajana gidiyor (sağlayıcı katmanı).
 *
 * SINIR: parola container'a ortam değişkeniyle geçiyor ve `docker inspect` ile
 * görülebilir. docker.sock'a erişebilen biri zaten host'ta root; bilinerek
 * kabul edilmiş bir ödün.
 */

export function resticImage(): string {
  return getString("backup.restic_image");
}

export function resticTimeoutMs(): number {
  return getNumber("backup.timeout_minutes") * 60_000;
}

export function stagingVolume(): string {
  return getString("backup.staging_volume") || "panel-backup-staging";
}

/** SMB/NFS konumunun Docker volume adı. */
export function mountVolumeName(repoId: number): string {
  return `panel-backup-repo-${repoId}`;
}

/**
 * SMB/NFS konumunu Docker'ın yerel sürücüsüyle bağlar. Mount'u Docker daemon
 * yapıyor: host'ta elle işlem ya da panele ek yetki gerekmiyor. Volume zaten
 * varsa dokunulmaz (konum düzenlenince `forgetMountVolume` siler).
 */
async function ensureMountVolume(repo: RepoSecrets): Promise<string> {
  const name = mountVolumeName(repo.id);
  const docker = getDockerProvider();
  if (await docker.inspectVolumeRaw(name)) return name;
  await docker.createVolume({
    name,
    driver: "local",
    driverOpts: mountVolumeOptions(repo.kind as "smb" | "nfs", repo.location, repo.mountEnv),
    labels: { "panel.backup.repo": String(repo.id) },
  });
  return name;
}

/** Konum ayarı değişince eski bağlantı seçenekleriyle kalmasın. */
export async function forgetMountVolume(repoId: number): Promise<void> {
  try {
    await getDockerProvider().removeResource("volume", mountVolumeName(repoId), true);
  } catch {
    // Yoksa ya da kullanımdaysa sorun değil; bir sonraki koşu yeniden dener.
  }
}

export async function repoBinds(repo: RepoSecrets): Promise<string[]> {
  if (repo.kind === "local") return [`${repo.location}:${REPO_MOUNT}`];
  if (repo.kind === "smb" || repo.kind === "nfs") return [`${await ensureMountVolume(repo)}:${REPO_MOUNT}`];
  return [];
}

function resticEnv(repo: RepoSecrets): Record<string, string> {
  return {
    RESTIC_REPOSITORY: repositoryUrl(repo.kind, repo.location),
    RESTIC_PASSWORD: repo.password,
    // İlerleme satırları saniyede bir; daha sık yazmak çıktıyı şişirir.
    RESTIC_PROGRESS_FPS: "1",
    RESTIC_CACHE_DIR: "/tmp/restic-cache",
    ...repo.env,
  };
}

/**
 * Düşük öncelik: `ionice -c3` (boşta G/Ç) + `nice -n 19`. ionice yoksa ya da
 * izin verilmezse yalnızca nice — yedek yine de çalışmalı.
 */
const LOW_PRIORITY_ENTRYPOINT = [
  "sh",
  "-c",
  'if ionice -c3 true 2>/dev/null; then exec ionice -c3 nice -n 19 restic "$@"; else exec nice -n 19 restic "$@"; fi',
  "restic",
];

export type ResticOptions = {
  binds?: string[];
  lowPriority?: boolean;
  user?: string;
  namePrefix?: string;
};

async function spec(repo: RepoSecrets, args: string[], options: ResticOptions): Promise<ThrowawaySpec> {
  return {
    image: resticImage(),
    cmd: args,
    ...(options.lowPriority ? { entrypoint: LOW_PRIORITY_ENTRYPOINT } : {}),
    binds: [...(await repoBinds(repo)), ...(options.binds ?? [])],
    env: resticEnv(repo),
    namePrefix: options.namePrefix ?? "panel-restic",
    timeoutMs: resticTimeoutMs(),
    // Kaynaklar (/root, /etc/shadow, 750 ev dizinleri) root ister.
    user: options.user ?? "0:0",
  };
}

/**
 * restic ortamıyla kabuk betiği — çıktıyı dosyaya yönlendirmek gerektiğinde
 * (`restic dump ... > /out/dosya`). Betik içinde `restic` doğrudan çağrılır.
 */
export async function resticShell(repo: RepoSecrets, script: string, options: ResticOptions = {}): Promise<ExecResult> {
  const base = await spec(repo, [script], options);
  return getDockerProvider().runThrowaway({ ...base, entrypoint: ["sh", "-c"] });
}

/** Tek parça çalıştırma — kısa komutlar (snapshots, ls, stats, check). */
export async function resticRun(repo: RepoSecrets, args: string[], options: ResticOptions = {}): Promise<ExecResult> {
  return getDockerProvider().runThrowaway(await spec(repo, args, options));
}

export type StreamResult = {
  exitCode: number;
  cancelled: boolean;
  timedOut: boolean;
  /** Son ~200 satır (JSON durum satırları hariç) — hata ayıklama için. */
  tail: string[];
};

/** Akışlı çalıştırma — her satır `onLine`'a gelir (canlı ilerleme). */
export async function resticStream(
  repo: RepoSecrets,
  args: string[],
  options: ResticOptions & { signal: AbortSignal; onLine: (line: string, stream: "stdout" | "stderr") => void },
): Promise<StreamResult> {
  const tail: string[] = [];
  let result: StreamResult = { exitCode: -1, cancelled: false, timedOut: false, tail };
  for await (const event of getDockerProvider().runThrowawayStream(await spec(repo, args, options), options.signal)) {
    if (event.type === "line") {
      options.onLine(event.text, event.stream);
      if (!event.text.includes('"message_type":"status"')) {
        tail.push(event.text);
        if (tail.length > 200) tail.shift();
      }
    } else {
      result = { exitCode: event.exitCode, cancelled: event.cancelled, timedOut: event.timedOut, tail };
    }
  }
  return result;
}

/**
 * restic imajındaki kabukla yardımcı adım (df, staging temizliği, dosya
 * yazma). Konum bağlıysa `/repo` altında görünür.
 */
export async function shellRun(
  script: string,
  options: { binds: string[]; env?: Record<string, string>; image?: string; networkMode?: string; namePrefix?: string },
): Promise<ExecResult> {
  return getDockerProvider().runThrowaway({
    image: options.image ?? resticImage(),
    entrypoint: ["sh", "-c"],
    cmd: [script],
    binds: options.binds,
    env: options.env ?? {},
    namePrefix: options.namePrefix ?? "panel-backup-step",
    timeoutMs: resticTimeoutMs(),
    user: "0:0",
    ...(options.networkMode ? { networkMode: options.networkMode } : {}),
  });
}

/** Konumdaki boş alan (local/smb/nfs); bulut konumlarında null. */
export async function repoFreeSpace(repo: RepoSecrets): Promise<{ freeBytes: number; totalBytes: number } | null> {
  if (repo.kind === "s3" || repo.kind === "rclone") return null;
  // Yerel konum henüz yoksa df hata verir; üst dizin oluşturulmuş olmalı.
  const result = await shellRun(`mkdir -p ${REPO_MOUNT} && df -Pk ${REPO_MOUNT}`, {
    binds: await repoBinds(repo),
    namePrefix: "panel-backup-df",
  });
  return result.exitCode === 0 ? parseDf(result.output) : null;
}
