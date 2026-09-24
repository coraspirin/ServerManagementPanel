import { requirePermission } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/session";
import { listHosts } from "@/lib/hosts/store";
import { toHostView } from "@/lib/hosts/view";
import { HostsScreen } from "./HostsScreen";

export const dynamic = "force-dynamic";

/** Sunucular — liste, durum ve (hosts.manage ile) kayıt/yönetim. */
export default async function HostsPage() {
  const session = await requirePermission("hosts.view");

  return (
    <HostsScreen
      initial={listHosts().map(toHostView)}
      canManage={hasPermission(session.user, "hosts.manage")}
    />
  );
}
