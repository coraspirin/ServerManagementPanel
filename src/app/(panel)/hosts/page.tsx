import { requirePermission } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/session";
import { listHosts } from "@/lib/hosts/store";
import { toHostView } from "@/lib/hosts/view";
import { HostsScreen } from "./HostsScreen";
import { hostFeatures } from "@/lib/permissions/features.server";

export const dynamic = "force-dynamic";

/** Sunucular — liste, durum ve (hosts.manage ile) kayıt/yönetim. */
export default async function HostsPage({
  searchParams,
}: {
  searchParams: Promise<{ ekle?: string }>;
}) {
  const session = await requirePermission("hosts.view");
  const { ekle } = await searchParams;

  return (
    <HostsScreen
      initial={listHosts().map((host) => ({ ...toHostView(host), features: hostFeatures(host) }))}
      canManage={hasPermission(session.user, "hosts.manage")}
      canUpdate={hasPermission(session.user, "panel.update")}
      openAdd={ekle === "1"}
    />
  );
}
