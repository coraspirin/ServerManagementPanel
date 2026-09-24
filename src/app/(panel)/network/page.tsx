import { requireLocalPage } from "@/lib/hosts/request";
import { requirePermission } from "@/lib/auth/guard";
import { networkPayload } from "@/app/api/network/route";
import { SpeedtestSection } from "@/components/network/SpeedtestSection";
import { TailscaleSection } from "@/components/network/TailscaleSection";
import { listSpeedtests } from "@/lib/network/speedtest";
import { tailscaleStatus } from "@/lib/tailscale/status";
import { NetworkScreen } from "./NetworkScreen";

export const dynamic = "force-dynamic";

/** Ağ keşfi ve Wake-on-LAN ekranı (M2.9 + M2.11). */
export default async function NetworkPage() {
  await requirePermission("network.manage");
  await requireLocalPage();

  const [payload, tailscale] = await Promise.all([networkPayload(), tailscaleStatus()]);

  return (
    <div className="space-y-6">
      <NetworkScreen
        initialDevices={payload.devices}
        initialWol={payload.wol}
        subnet={payload.subnet}
        oui={payload.oui}
      />
      <TailscaleSection status={tailscale} />
      <SpeedtestSection initial={listSpeedtests()} />
    </div>
  );
}
