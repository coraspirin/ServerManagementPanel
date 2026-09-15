import { requirePermission } from "@/lib/auth/guard";
import { queryAudit } from "@/lib/auth/audit";
import { AuditScreen } from "./AuditScreen";

export const dynamic = "force-dynamic";

/** Denetim kayıtları (M3.1) — kim, ne zaman, neyi değiştirdi. */
export default async function AuditPage() {
  await requirePermission("audit.view");

  return <AuditScreen initial={queryAudit({ limit: 100 })} />;
}
