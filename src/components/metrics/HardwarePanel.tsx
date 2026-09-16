import { HardDrive, Info, Layers, Thermometer } from "lucide-react";
import { formatBytes } from "@/lib/metrics/catalog";
import type { HardwareReport } from "@/lib/providers/types";
import { formatNumber, formatPct, formatRelative } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/locales";
import { getActiveDictionary, getT } from "@/lib/i18n/server";
import type { TFunction } from "@/lib/i18n/translate";

/**
 * Donanım sağlığı paneli (M1.4).
 *
 * Sunucu bileşeni: sıcaklık ve S.M.A.R.T saniyede bir değişen veriler değil,
 * sayfa yenilendiğinde tazelenmeleri yeterli. İstemci tarafı yenileme eklemek
 * bedava değil (her tur /sys taraması) ve karşılığında bir şey kazandırmaz.
 */

type Thresholds = {
  tempWarn: number;
  tempCrit: number;
  scrubOverdueDays: number;
  reportStaleHours: number;
};

function tempColor(celsius: number, warn: number, crit: number): string {
  if (celsius >= crit) return "bg-danger";
  if (celsius >= warn) return "bg-warn";
  return "bg-ok";
}

function tempText(celsius: number, warn: number, crit: number): string {
  if (celsius >= crit) return "text-danger";
  if (celsius >= warn) return "text-warn";
  return "text-ink";
}

function formatHours(hours: number | null, t: TFunction, dict: Dictionary): string {
  if (hours === null) return "—";
  const years = hours / 8760;
  const count = formatNumber(hours, dict);
  return years >= 1
    ? t("hardware.hoursYears", { hours: count, years: years.toFixed(1) })
    : t("hardware.hours", { hours: count });
}

/**
 * Rapor eskimiş mi?
 *
 * Bileşen gövdesinde değil burada hesaplanıyor: React'in saflık kuralı render
 * sırasında `Date.now()` çağrılmasını istemiyor ve haklı — ama bu bir sunucu
 * bileşeni ve değer istekle birlikte donuyor.
 */
function isReportStale(report: HardwareReport, staleHours: number): boolean {
  const needsReport =
    report.disks.length > 0 || report.pools.some((pool) => pool.kind === "zfs");
  if (!needsReport) return false;
  if (report.reportedAt === null) return true;
  return Date.now() / 1000 - report.reportedAt > staleHours * 3600;
}

function formatAge(ts: number | null, t: TFunction, dict: Dictionary): string {
  if (ts === null) return t("hardware.neverReported");
  return formatRelative(ts * 1000, dict);
}

export function HardwarePanel({
  report,
  thresholds,
}: {
  report: HardwareReport;
  thresholds: Thresholds;
}) {
  const empty =
    report.temperatures.length === 0 &&
    report.disks.length === 0 &&
    report.pools.length === 0;

  const reportStale = isReportStale(report, thresholds.reportStaleHours);
  const t = getT();
  const dict = getActiveDictionary();

  return (
    <div className="space-y-4">
      {report.notes.length > 0 && (
        <div className="flex gap-2 rounded-lg border border-line bg-surface px-5 py-4">
          <Info className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden />
          <div className="space-y-1 text-sm text-subtle">
            {report.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </div>
        </div>
      )}

      {empty ? null : (
        <div className="grid gap-4 xl:grid-cols-2">
          {report.temperatures.length > 0 && (
            <section className="rounded-lg border border-line bg-surface p-5">
              <h2 className="flex items-center gap-1.5 font-semibold">
                <Thermometer className="size-4" /> {t("hardware.temperatures")}
              </h2>
              <div className="mt-4 space-y-3">
                {report.temperatures.map((reading) => {
                  const warn = reading.highC ?? thresholds.tempWarn;
                  const crit = reading.criticalC ?? thresholds.tempCrit;
                  const percent = Math.min(100, (reading.celsius / crit) * 100);

                  return (
                    <div key={reading.id}>
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="truncate">
                          {reading.label}
                          <span className="ml-1.5 text-xs text-subtle">{reading.source}</span>
                        </span>
                        <span
                          className={`shrink-0 text-xs font-medium ${tempText(reading.celsius, warn, crit)}`}
                        >
                          {reading.celsius.toFixed(1)} °C
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
                        <div
                          className={`h-full rounded-full ${tempColor(reading.celsius, warn, crit)}`}
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      <p className="mt-0.5 text-[10px] text-subtle">
                        {t("hardware.thresholds", { warn, crit })}
                        {reading.highC !== null && t("hardware.sensorOwn")}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {report.pools.length > 0 && (
            <section className="rounded-lg border border-line bg-surface p-5">
              <h2 className="flex items-center gap-1.5 font-semibold">
                <Layers className="size-4" /> {t("hardware.pools")}
              </h2>
              <div className="mt-4 space-y-3">
                {report.pools.map((pool) => (
                  <div key={`${pool.kind}-${pool.name}`} className="text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`size-2 rounded-full ${pool.healthy ? "bg-ok" : "bg-danger"}`}
                      />
                      <span className="font-medium">{pool.name}</span>
                      <span className="rounded border border-line px-1 text-[10px] uppercase text-subtle">
                        {pool.kind}
                      </span>
                      <span className={pool.healthy ? "text-xs text-ok" : "text-xs text-danger"}>
                        {pool.state}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-subtle">{pool.detail}</p>
                    {pool.devices.length > 0 && (
                      <p className="mt-0.5 font-mono text-[11px] text-subtle">
                        {pool.devices.map((d) => `${d.name} (${d.state})`).join(" · ")}
                      </p>
                    )}
                    {pool.scrubResult && (
                      <p className="mt-0.5 text-[11px] text-subtle">scrub: {pool.scrubResult}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {report.disks.length > 0 && (
            <section className="rounded-lg border border-line bg-surface p-5 xl:col-span-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="flex items-center gap-1.5 font-semibold">
                  <HardDrive className="size-4" /> {t("hardware.disks")}
                </h2>
                <span className={`text-xs ${reportStale ? "text-warn" : "text-subtle"}`}>
                  {t("hardware.report", { when: formatAge(report.reportedAt, t, dict) })}
                  {reportStale && t("hardware.notUpdating")}
                </span>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="rtable w-full min-w-[46rem] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-subtle">
                      <th className="pb-2 pr-4 font-medium">{t("hardware.col.device")}</th>
                      <th className="pb-2 pr-4 font-medium">{t("hardware.col.status")}</th>
                      <th className="pb-2 pr-4 font-medium">{t("hardware.col.temperature")}</th>
                      <th className="pb-2 pr-4 font-medium">{t("hardware.col.powerOn")}</th>
                      <th className="pb-2 pr-4 font-medium">{t("hardware.col.reallocated")}</th>
                      <th className="pb-2 pr-4 font-medium">{t("hardware.col.pending")}</th>
                      <th className="pb-2 font-medium">{t("hardware.col.wear")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {report.disks.map((disk) => {
                      const bad =
                        (disk.reallocatedSectors ?? 0) > 0 || (disk.pendingSectors ?? 0) > 0;
                      return (
                        <tr key={disk.device}>
                          <td data-label="" className="py-2 pr-4">
                            <div className="font-mono text-xs">{disk.device}</div>
                            <div className="text-xs text-subtle">{disk.model}</div>
                            {disk.sizeBytes !== null && (
                              <div className="text-[10px] text-subtle">
                                {formatBytes(disk.sizeBytes)}
                              </div>
                            )}
                          </td>
                          <td data-label={t("hardware.col.status")} className="py-2 pr-4">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                disk.health === "PASSED"
                                  ? "bg-ok/15 text-ok"
                                  : disk.health === "FAILED"
                                    ? "bg-danger/15 text-danger"
                                    : "bg-line text-subtle"
                              }`}
                            >
                              {disk.health}
                            </span>
                          </td>
                          <td data-label={t("hardware.col.temperature")} className="py-2 pr-4 text-xs">
                            {disk.temperatureC === null ? "—" : `${disk.temperatureC} °C`}
                          </td>
                          <td data-label={t("hardware.col.powerOn")} className="py-2 pr-4 text-xs">
                            {formatHours(disk.powerOnHours, t, dict)}
                          </td>
                          <td data-label={t("hardware.col.reallocated")} className={`py-2 pr-4 text-xs ${bad ? "text-warn" : ""}`}>
                            {disk.reallocatedSectors ?? "—"}
                          </td>
                          <td data-label={t("hardware.col.pending")} className={`py-2 pr-4 text-xs ${bad ? "text-warn" : ""}`}>
                            {disk.pendingSectors ?? "—"}
                          </td>
                          <td data-label={t("hardware.col.wear")} className="py-2 text-xs">
                            {disk.percentageUsed === null ? "—" : formatPct(disk.percentageUsed, dict, 0)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <p className="mt-3 text-[11px] text-subtle">
                {t("hardware.note")}
              </p>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
