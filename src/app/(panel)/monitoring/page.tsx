import { CapacityPanel } from "@/components/metrics/CapacityPanel";
import { HardwarePanel } from "@/components/metrics/HardwarePanel";
import { requirePermission } from "@/lib/auth/guard";
import { CHART_METRICS, isRangeId, type RangeId } from "@/lib/metrics/catalog";
import { latestSnapshot } from "@/lib/metrics/collect";
import { diskForecasts } from "@/lib/metrics/forecast";
import { querySeriesForRange } from "@/lib/metrics/query";
import { getHardwareProvider, getSystemProvider } from "@/lib/providers";
import { getNumber, getString } from "@/lib/settings";
import { MonitoringScreen } from "./MonitoringScreen";

export const dynamic = "force-dynamic";

/**
 * İzleme ekranı (M1.1).
 *
 * İlk kartlar ve grafikler sunucuda hazırlanıp gönderilir: sayfa açılır açılmaz
 * dolu görünsün, istemci yalnızca tazelesin.
 */
export default async function MonitoringPage() {
  await requirePermission("metrics.view");

  const configured = getString("monitoring.chart_default_range");
  const range: RangeId = isRangeId(configured) ? configured : "24h";

  const [system, hardware] = await Promise.all([
    getSystemProvider().info(),
    getHardwareProvider().report(),
  ]);

  return (
    <div className="space-y-6">
      <MonitoringScreen
        initialSnapshot={latestSnapshot()}
        initialSeries={querySeriesForRange(CHART_METRICS, range)}
        defaultRange={range}
        refreshSeconds={getNumber("general.ui_refresh_interval")}
        cpuCount={system.cpuCount}
        thresholds={{
          cpuWarn: getNumber("alerts.cpu.warn"),
          cpuCrit: getNumber("alerts.cpu.crit"),
          ramWarn: getNumber("alerts.ram.warn"),
          ramCrit: getNumber("alerts.ram.crit"),
          diskWarn: getNumber("alerts.disk.warn"),
          diskCrit: getNumber("alerts.disk.crit"),
        }}
      />

      <CapacityPanel
        forecasts={diskForecasts()}
        horizonDays={getNumber("alerts.capacity_forecast_days")}
      />

      <HardwarePanel
        report={hardware}
        thresholds={{
          tempWarn: getNumber("alerts.temp.warn"),
          tempCrit: getNumber("alerts.temp.crit"),
          scrubOverdueDays: getNumber("hardware.raid.scrub_overdue_days"),
          reportStaleHours: getNumber("hardware.report_stale_hours"),
        }}
      />
    </div>
  );
}
