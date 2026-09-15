import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { getNumber, getString } from "@/lib/settings";
import { lastSuccessfulRunAt } from "./store";

/**
 * Yedek klasörü takibi (M1.10 + M3.4).
 *
 * Tek bir soru soruyor: **"en son yedek ne zaman alındı?"** Çünkü yedekleme
 * sisteminin en sinsi arızası çökmesi değil, sessizce durmasıdır — kimse fark
 * etmez, ta ki geri yüklemek gerekene kadar.
 *
 * İKİ KAYNAĞA birden bakıyor: izlenen klasördeki en yeni dosya (panelin
 * dışında, elle ya da başka bir araçla alınan yedekler) ve M3.4 motorunun en
 * son BAŞARILI çalışması. Yalnızca klasöre bakmak, motor uzak bir depoya
 * yazdığında "hiç yedek yok" demek olurdu.
 *
 * Klasör host kökü üzerinden okunuyor (`/host/root`, salt-okunur). Yol
 * ayarlardan geliyor; boşsa klasör takibi kapalıdır ve panel bunu açıkça söyler.
 */

const HOST_ROOT = process.env.HOST_ROOT ?? "/host/root";

export type BackupStatus = {
  /** Ayarda bir klasör tanımlı mı. */
  watching: boolean;
  dir: string;
  newestAt: number | null;
  newestName: string | null;
  fileCount: number;
  totalBytes: number;
  staleAfterHours: number;
  /** En yeni yedek eşikten eskiyse (ya da hiç yedek yoksa) true. */
  stale: boolean;
  error: string | null;
  /** M3.4 motorunun en son başarılı çalışması; hiç çalışmadıysa null. */
  engineLastRunAt: number | null;
};

/** İki kaynaktan hangisi daha yeniyse o. İkisi de yoksa null. */
function newerOf(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/**
 * Ayardaki yolu container içinden okunabilir hale getirir.
 *
 * Kullanıcı "/mnt/yedek" yazar; container içinde bu yol yoktur, host kökü
 * `/host/root` altına bağlıdır. Dönüşümü kullanıcıya yaptırmak, panelin
 * dağıtım ayrıntısını kullanıcının kafasına yıkması olurdu.
 */
function resolveHostPath(dir: string): string {
  if (!dir.startsWith("/")) return dir;
  return path.join(HOST_ROOT, dir);
}

export async function backupStatus(): Promise<BackupStatus> {
  const dir = getString("backup.watch_dir").trim();
  const staleAfterHours = getNumber("backup.stale_after_hours");
  const engineLastRunAt = lastSuccessfulRunAt();
  const now = Math.floor(Date.now() / 1000);
  const tooOld = (ts: number | null) =>
    ts === null || now - ts > staleAfterHours * 3600;

  const base: BackupStatus = {
    watching: dir !== "",
    dir,
    newestAt: null,
    newestName: null,
    fileCount: 0,
    totalBytes: 0,
    staleAfterHours,
    stale: false,
    error: null,
    engineLastRunAt,
  };

  // Klasör takibi kapalı olsa bile motor çalışıyorsa durum bilinebilir.
  if (dir === "") return { ...base, stale: engineLastRunAt !== null && tooOld(engineLastRunAt) };

  const resolved = resolveHostPath(dir);

  try {
    const entries = await readdir(resolved, { withFileTypes: true });
    let newestAt: number | null = null;
    let newestName: string | null = null;
    let fileCount = 0;
    let totalBytes = 0;

    for (const entry of entries) {
      // Alt klasörlere inilmiyor: restic/borg depoları binlerce parça dosya
      // tutar ve hepsini gezmek her sayfa açılışında diski döverdi. Takip
      // "yeni bir yedek düştü mü" sorusuna bakıyor, deponun içine değil.
      if (!entry.isFile() && !entry.isDirectory()) continue;

      const full = path.join(resolved, entry.name);
      const info = await stat(full).catch(() => null);
      if (!info) continue;

      const mtime = Math.floor(info.mtimeMs / 1000);
      if (entry.isFile()) {
        fileCount += 1;
        totalBytes += info.size;
      }
      if (newestAt === null || mtime > newestAt) {
        newestAt = mtime;
        newestName = entry.name;
      }
    }

    return {
      ...base,
      newestAt,
      newestName,
      fileCount,
      totalBytes,
      // İki kaynaktan biri tazeyse yedek alınıyor demektir.
      stale: tooOld(newerOf(newestAt, engineLastRunAt)),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "klasör okunamadı";
    return {
      ...base,
      // Okunamayan klasör "yedek yok" ile aynı şey değil; ayrı söylenmeli.
      error: message.includes("ENOENT")
        ? `Klasör bulunamadı: ${dir} (host kökü ${HOST_ROOT} altına bağlı mı?)`
        : message,
    };
  }
}
