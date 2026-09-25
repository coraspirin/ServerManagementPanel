import { requirePermission } from "@/lib/auth/guard";
import { checkForUpdate, updateStatus } from "@/lib/selfupdate";
import { UpdateScreen } from "./UpdateScreen";

export const dynamic = "force-dynamic";

export default async function UpdatePage() {
  await requirePermission("panel.update");
  const [check, status] = await Promise.all([checkForUpdate(), updateStatus()]);

  return <UpdateScreen initialCheck={check} initialStatus={status} />;
}
