import { requirePermission } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/session";
import { helperConfigured } from "@/lib/host/helper";
import { getNumber } from "@/lib/settings";
import { HostScreen } from "./HostScreen";

export const dynamic = "force-dynamic";

/** Güç, systemd, compose ve konsol (M1.12 + M1.13). */
export default async function HostPage() {
  const session = await requirePermission("host.service");

  return (
    <HostScreen
      helperReady={helperConfigured()}
      canPower={hasPermission(session.user, "host.power")}
      canService={hasPermission(session.user, "host.service")}
      canShell={hasPermission(session.user, "host.shell")}
      consoleMaxLines={getNumber("console.history_lines")}
    />
  );
}
