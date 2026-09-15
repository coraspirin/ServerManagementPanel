import { requirePermission } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/session";
import { listMaintenanceWindows } from "@/lib/monitors/maintenance";
import { monitorViews } from "@/lib/monitors/store";
import { getNumber } from "@/lib/settings";
import { UptimeScreen } from "./UptimeScreen";

export const dynamic = "force-dynamic";

/** Servis Durumu ekranı (M1.2). */
export default async function UptimePage() {
  const session = await requirePermission("metrics.view");

  return (
    <UptimeScreen
      initialMonitors={monitorViews()}
      initialWindows={listMaintenanceWindows()}
      defaults={{
        intervalSeconds: getNumber("health.interval"),
        timeoutSeconds: getNumber("health.timeout"),
        retries: getNumber("health.retries"),
        downThreshold: getNumber("health.down_threshold"),
      }}
      canManage={hasPermission(session.user, "monitors.manage")}
      refreshSeconds={getNumber("general.ui_refresh_interval")}
    />
  );
}
