import "server-only";

import path from "node:path";

import { getDockerProvider } from "@/lib/providers";

/**
 * Bir container'ın geldiği compose dosyasının bulunması (M3.19).
 *
 * Yol TAHMİN EDİLMİYOR, Docker'ın kendi etiketlerinden okunuyor —
 * `com.docker.compose.project.config_files` ve `.working_dir`. M1.12'de yığın
 * keşfi için alınan kararın aynısı (`src/app/api/host/compose/route.ts`): iki
 * ayrı kaynak tutmak, ikisinin zamanla ayrışması demek.
 *
 * ⚠️ BU AYNI ZAMANDA BİR GÜVENLİK SINIRIDIR. Compose dosyası yazma yolu
 * (`edit.ts`) yalnızca buradan çıkmış bir konumu kabul ediyor; istemciden gelen
 * ham bir dosya yolunu asla. Böylece panel, gerçekten çalışan bir compose
 * projesinin kendi bildirdiği dosyası dışında hiçbir yere yazamıyor —
 * `files.roots` ayarına bağlanmadan, kendi başına duran bir kısıt.
 */

export type ComposeLocation = {
  containerId: string;
  project: string;
  service: string;
  workingDir: string;
  /** Düzenlenecek dosya — birden çok varsa ilki. */
  file: string;
  /** Projenin bildirdiği tüm compose dosyaları. */
  allFiles: string[];
};

export type LocateResult = ComposeLocation | { error: string };

export function isLocated(result: LocateResult): result is ComposeLocation {
  return !("error" in result);
}

export async function locateCompose(containerId: string): Promise<LocateResult> {
  let raw: { Config?: { Labels?: Record<string, string> } } | null;
  try {
    raw = (await getDockerProvider().inspectRaw(containerId)) as typeof raw;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Container okunamadı." };
  }

  const labels = raw?.Config?.Labels ?? {};
  const project = labels["com.docker.compose.project"] ?? "";
  const service = labels["com.docker.compose.service"] ?? "";

  if (!project) {
    return { error: "Bu container bir compose yığınına ait değil." };
  }

  const workingDir = labels["com.docker.compose.project.working_dir"] ?? "";
  const configFiles = (labels["com.docker.compose.project.config_files"] ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    // Etiket göreli yol taşıyabiliyor; proje dizinine göre çözülüyor.
    .map((entry) => (entry.startsWith("/") ? entry : path.posix.join(workingDir, entry)));

  if (configFiles.length === 0) {
    return {
      error:
        `${project} yığınının compose dosyası etiketlerde yazmıyor. Bu container büyük ` +
        "ihtimalle compose dışında bir yolla oluşturulmuş; panel hangi dosyayı " +
        "düzenleyeceğini bilemez.",
    };
  }

  if (!workingDir) {
    return { error: `${project} yığınının proje dizini etiketlerde yazmıyor.` };
  }

  return {
    containerId,
    project,
    service,
    workingDir,
    file: configFiles[0],
    allFiles: configFiles,
  };
}
