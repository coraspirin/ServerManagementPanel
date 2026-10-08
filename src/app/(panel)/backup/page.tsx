import { enterHost } from "@/lib/hosts/context";
import { pageHostId } from "@/lib/hosts/request";
import { requirePermission } from "@/lib/auth/guard";
import { backupOverview } from "@/lib/backup/overview";
import { BackupPage } from "@/components/backup/BackupPage";

export const dynamic = "force-dynamic";

/** Yedekleme — Docker · İşletim Sistemi · Veritabanı. */
export default async function BackupRoute({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requirePermission("backup.manage");
  const hostId = await pageHostId({ agent: true });
  enterHost(hostId);

  return (
    <BackupPage
      initial={backupOverview()}
      initialTab={(await searchParams).tab ?? ""}
    />
  );
}
