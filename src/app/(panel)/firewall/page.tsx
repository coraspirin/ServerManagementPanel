import { requireLocalPage } from "@/lib/hosts/request";
import { requirePermission } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/session";
import { firewallState } from "@/lib/security/firewall";
import { cachedPortScan } from "@/lib/security/ports";
import { dockerPublishedPorts } from "@/lib/security/portmap";
import { FirewallScreen } from "./FirewallScreen";

export const dynamic = "force-dynamic";

/**
 * Güvenlik duvarı (M3.18).
 *
 * Port haritası ÖNBELLEKTEN okunuyor, taranmıyor: buradaki tek kullanımı
 * "bu kural gerçekten bir şeyi koruyor mu" ve "bu port Docker yayınlı mı"
 * sorularına cevap vermek ve bunun için container açmaya değmez.
 */
export default async function FirewallPage() {
  const session = await requirePermission("security.view");
  await requireLocalPage();
  const scan = cachedPortScan();

  return (
    <FirewallScreen
      initial={await firewallState()}
      listeners={Object.fromEntries(
        scan.ports.map((port) => [port.port, port.owner.name || port.process]),
      )}
      dockerPublished={[...dockerPublishedPorts(scan.containers)]}
      portsScannedAt={scan.updatedAt}
      canManage={hasPermission(session.user, "security.manage")}
    />
  );
}
