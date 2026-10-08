import "server-only";

import { appVersion } from "@/lib/env";
import { currentHostId } from "@/lib/hosts/context";
import { serverT } from "@/lib/i18n/runtime";
import { tagFor } from "./engine";
import { splitSmbLocation } from "./restic";
import { listJobs } from "./store/jobs";
import { getRepo, repoSecrets } from "./store/repos";

/**
 * Kurtarma kiti: panel ya da sunucu tamamen gittiğinde yedeği açmak için
 * gereken her şey — konum adresi, parola, gizli ortam değişkenleri ve
 * restic komutları. İsteğe bağlı MASTER_KEY: yedekten kurulan yeni panel
 * şifreli ayarları (depo parolaları, bildirim token'ları) çözebilsin.
 *
 * ⚠️ Bu dosya yedeklerin anahtarı; panel bunu yalnızca oturum parolası
 * yeniden girilince üretir ve her üretim denetim kaydına yazılır.
 */

export function recoveryKit(repoId: number, includeMasterKey: boolean): { fileName: string; text: string } | null {
  const repo = getRepo(repoId);
  const secrets = repoSecrets(repoId);
  if (!repo || !secrets) return null;
  const hostId = currentHostId();

  const exports: string[] = [];
  let repository: string;
  switch (repo.kind) {
    case "local":
      repository = repo.location;
      break;
    case "smb": {
      const { device, subPath } = splitSmbLocation(repo.location);
      repository = `/mnt/yedek${subPath}`;
      exports.push(
        `# ${serverT("backupKit.smbMount")}`,
        `# sudo mount -t cifs ${device} /mnt/yedek -o username=${secrets.mountEnv.SMB_USERNAME ?? "guest"}${secrets.mountEnv.SMB_PASSWORD ? `,password=${secrets.mountEnv.SMB_PASSWORD}` : ""}`,
      );
      break;
    }
    case "nfs":
      repository = "/mnt/yedek";
      exports.push(`# ${serverT("backupKit.nfsMount")}`, `# sudo mount -t nfs ${repo.location} /mnt/yedek`);
      break;
    default:
      repository = repo.location;
  }
  for (const [key, value] of Object.entries(secrets.env)) exports.push(`export ${key}='${value}'`);

  const jobs = listJobs().filter((job) => job.repoId === repoId);
  const tags = jobs.map((job) => `#   ${tagFor(job, hostId)}  →  ${job.category === "custom" ? job.name : serverT(`backup.category.${job.category}`)}`);

  const lines = [
    `# ${serverT("backupKit.title")}`,
    `# ${serverT("backupKit.generated", { date: new Date().toISOString(), version: appVersion() })}`,
    `# ${serverT("backupKit.location", { name: repo.name, kind: repo.kind, location: repo.location })}`,
    "#",
    `# ${serverT("backupKit.warning")}`,
    "",
    `export RESTIC_REPOSITORY='${repository}'`,
    `export RESTIC_PASSWORD='${secrets.password}'`,
    ...exports,
    "",
    `# ${serverT("backupKit.tags")}`,
    ...tags,
    "",
    `# ${serverT("backupKit.howto")}`,
    "#   restic snapshots",
    "#   restic ls latest --tag <tag>",
    "#   restic restore latest --tag <tag> --target /tmp/restore",
    `#   ${serverT("backupKit.dbHint")}`,
    "#   docker run --rm -it -v /tmp/restore:/restore restic/restic ...",
  ];

  if (includeMasterKey && process.env.MASTER_KEY) {
    lines.push("", `# ${serverT("backupKit.masterKey")}`, `MASTER_KEY=${process.env.MASTER_KEY}`);
  }

  const safeName = repo.name.replace(/[^A-Za-z0-9._-]+/g, "_");
  return { fileName: `kurtarma-kiti-${safeName}.txt`, text: `${lines.join("\n")}\n` };
}
