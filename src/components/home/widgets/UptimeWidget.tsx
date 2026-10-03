import { HeartPulse } from "lucide-react";
import { UptimeBars } from "@/components/monitors/UptimeBars";
import type { MonitorView } from "@/lib/monitors/types";
import { formatPct } from "@/lib/i18n/format";
import { getActiveDictionary, getT } from "@/lib/i18n/server";
import { WidgetCard, WidgetEmpty } from "./WidgetCard";

/** Bir widget'ta çok sayıda monitör listelemek, kartı Servis Durumu ekranına çevirirdi. */
const MAX_ROWS = 6;

/**
 * Uptime monitörleri — önce düşenler, sonra diğerleri; her biri son 30 günün
 * şeridi ve 24 saatlik oranıyla.
 */
export function UptimeWidget({ monitors, readOnly = false }: { monitors: MonitorView[]; readOnly?: boolean }) {
  const t = getT();
  const dict = getActiveDictionary();
  const enabled = monitors.filter((monitor) => monitor.enabled);
  const rank = (monitor: MonitorView) =>
    monitor.status === "down" && !monitor.inMaintenance ? 0 : monitor.status === "up" ? 2 : 1;
  const shown = [...enabled].sort((a, b) => rank(a) - rank(b)).slice(0, MAX_ROWS);
  const down = enabled.filter((monitor) => rank(monitor) === 0).length;

  return (
    <WidgetCard
      title={t("dashboard.uptime.title")}
      icon={HeartPulse}
      href={readOnly ? undefined : "/uptime"}
      linkLabel={t("dashboard.all")}
      aside={
        enabled.length > 0 ? (
          <span className={`shrink-0 text-xs ${down > 0 ? "font-medium text-danger" : "text-subtle"}`}>
            {down > 0
              ? t("dashboard.uptime.down", { count: down })
              : t("dashboard.uptime.allUp", { count: enabled.length })}
          </span>
        ) : undefined
      }
    >
      {shown.length === 0 ? (
        <WidgetEmpty>{t("dashboard.uptime.empty")}</WidgetEmpty>
      ) : (
        <ul className="space-y-2.5">
          {shown.map((monitor) => {
            const isDown = rank(monitor) === 0;
            return (
              <li key={monitor.id} className="min-w-0">
                <div className="flex items-center gap-2 text-sm">
                  <span
                    className={`size-2 shrink-0 rounded-full ${
                      monitor.inMaintenance ? "bg-brand/60" : isDown ? "bg-danger" : monitor.status === "up" ? "bg-ok" : "bg-line"
                    }`}
                    aria-hidden
                  />
                  <span className={`min-w-0 flex-1 truncate ${isDown ? "font-medium text-danger" : ""}`}>
                    {monitor.name}
                  </span>
                  {isDown && <span className="shrink-0 text-xs font-medium text-danger">{t("dashboard.uptime.isDown")}</span>}
                  <span className="shrink-0 text-xs tabular-nums text-subtle">
                    {monitor.uptime24h === null ? "—" : formatPct(monitor.uptime24h, dict, 2)}
                  </span>
                </div>
                <div className="mt-1">
                  <UptimeBars days={monitor.days} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetCard>
  );
}
