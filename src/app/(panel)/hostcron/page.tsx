import { requirePermission } from "@/lib/auth/guard";
import { readCron } from "@/lib/hostcron";
import { HostCronScreen } from "./HostCronScreen";

export const dynamic = "force-dynamic";

/** Host zamanlanmış görevleri (M3.9) — panelin kendi işlerinden ayrı. */
export default async function HostCronPage() {
  await requirePermission("cron.manage");

  return <HostCronScreen initial={await readCron()} />;
}
