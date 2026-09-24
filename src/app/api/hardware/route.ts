import { enterHost, guardHostApi } from "@/lib/auth/api";
import { getHardwareProvider } from "@/lib/providers";
import { getNumber, getString } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Donanım sağlığı: sıcaklık, S.M.A.R.T, RAID/ZFS (M1.4). */
export async function GET(request: Request) {
  const guard = await guardHostApi(request, "metrics.view");
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  return Response.json({
    report: await getHardwareProvider().report(),
    thresholds: {
      tempWarn: getNumber("alerts.temp.warn"),
      tempCrit: getNumber("alerts.temp.crit"),
      scrubOverdueDays: getNumber("hardware.raid.scrub_overdue_days"),
      reportStaleHours: getNumber("hardware.report_stale_hours"),
      tempSources: getString("hardware.temp_sources"),
    },
  });
}
