import { Container } from "lucide-react";
import type { ContainerOverview } from "@/lib/dashboard/summary";
import { formatBytes } from "@/lib/metrics/catalog";
import { formatPct } from "@/lib/i18n/format";
import { getActiveDictionary, getT } from "@/lib/i18n/server";
import { WidgetCard, WidgetEmpty } from "./WidgetCard";

/** Container özeti — sayılar, sorunlu olanlar ve en çok kaynak kullananlar. */
export function ContainerSummary({
  overview,
  readOnly = false,
}: {
  overview: ContainerOverview;
  readOnly?: boolean;
}) {
  const t = getT();
  const dict = getActiveDictionary();
  const topCpu = Math.max(1, ...overview.top.map((entry) => entry.cpuPct));

  return (
    <WidgetCard title={t("dashboard.containers.title")} icon={Container} href={readOnly ? undefined : "/docker"} linkLabel={t("dashboard.all")}>
      {!overview.available ? (
        <WidgetEmpty>{t("dashboard.containers.unavailable")}</WidgetEmpty>
      ) : (
        <div className="space-y-4">
          <dl className="grid grid-cols-3 gap-2 text-center">
            <Count label={t("dashboard.containers.running")} value={overview.running} className="text-ok" />
            <Count label={t("dashboard.containers.stopped")} value={overview.stopped} className="text-ink" />
            <Count
              label={t("dashboard.containers.troubled")}
              value={overview.troubled.length}
              className={overview.troubled.length > 0 ? "text-danger" : "text-ink"}
            />
          </dl>

          {overview.troubled.length > 0 && (
            <ul className="space-y-1 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs">
              {overview.troubled.map((entry) => (
                <li key={entry.name} className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{entry.name}</span>
                  <span className="shrink-0 text-danger">{t(`dashboard.containers.reason.${entry.reason}`)}</span>
                </li>
              ))}
            </ul>
          )}

          <div>
            <h3 className="mb-1.5 text-xs font-medium text-subtle">{t("dashboard.containers.top")}</h3>
            {overview.top.length === 0 ? (
              <p className="text-xs text-subtle">{t("dashboard.containers.noStats")}</p>
            ) : (
              <ul className="space-y-1.5">
                {overview.top.map((entry) => (
                  <li key={entry.name} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 text-xs">
                    <span className="truncate" title={entry.name}>{entry.name}</span>
                    <span className="w-14 text-right tabular-nums">{formatPct(entry.cpuPct, dict, 1)}</span>
                    <span className="w-16 text-right tabular-nums text-subtle">{formatBytes(entry.memUsed)}</span>
                    <span className="col-span-3 mt-0.5 h-1 overflow-hidden rounded-full bg-line" aria-hidden>
                      <span
                        className="block h-full rounded-full bg-brand"
                        style={{ width: `${(entry.cpuPct / topCpu) * 100}%` }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </WidgetCard>
  );
}

function Count({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className="rounded-md bg-canvas px-2 py-2">
      <dd className={`text-xl font-semibold tabular-nums ${className}`}>{value}</dd>
      <dt className="text-[11px] text-subtle">{label}</dt>
    </div>
  );
}
