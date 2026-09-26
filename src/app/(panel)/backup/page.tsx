import { enterHost } from "@/lib/hosts/context";
import { pageHostId } from "@/lib/hosts/request";
import { requirePermission } from "@/lib/auth/guard";
import { listJobs, listRepos, listRuns } from "@/lib/backup/store";
import { getDockerProvider } from "@/lib/providers";
import { BackupScreen } from "./BackupScreen";

export const dynamic = "force-dynamic";

/** Yedekleme motoru (M3.4). */
export default async function BackupPage() {
  await requirePermission("backup.manage");
  enterHost(await pageHostId({ agent: true }));

  // Kaynak seçicileri gerçek Docker envanterinden doldurulur; kullanıcı volume
  // adını elle yazarsa bir harf hatası yedeğin boş çıkmasına yol açardı.
  let volumes: string[] = [];
  let containers: string[] = [];
  try {
    const provider = getDockerProvider();
    volumes = (await provider.volumes()).map((volume) => volume.name).sort();
    containers = (await provider.list(true)).map((container) => container.name).sort();
  } catch {
    // Docker erişilemiyorsa ekran yine açılmalı: depo tanımlamak için gerekmiyor.
  }

  return (
    <BackupScreen
      initial={{ repos: listRepos(), jobs: listJobs(), runs: listRuns(50) }}
      volumes={volumes}
      containers={containers}
    />
  );
}
