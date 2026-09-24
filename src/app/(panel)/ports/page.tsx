import { enterHost } from "@/lib/hosts/context";
import { pageHostId } from "@/lib/hosts/request";
import { requirePermission } from "@/lib/auth/guard";
import { cachedPortScan } from "@/lib/security/ports";
import { PortsScreen } from "./PortsScreen";

export const dynamic = "force-dynamic";

/**
 * Port haritası (M3.17).
 *
 * Sayfa açılışında YALNIZCA önbellek okunuyor — tarama container açtığı için
 * her girişte çalıştırılamaz. Önbelleği ya `ports.scan` işi ya da kullanıcının
 * "Tara" düğmesi tazeler; ekran verinin yaşını her zaman yazar.
 */
export default async function PortsPage() {
  await requirePermission("security.view");
  enterHost(await pageHostId());

  return <PortsScreen initial={cachedPortScan()} />;
}
