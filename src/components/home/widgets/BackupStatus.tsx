import { Archive, CheckCircle2, CircleAlert, CircleDashed, Loader2, PauseCircle, TriangleAlert } from "lucide-react";
import type { SystemState, SystemStatus } from "@/lib/backup/overview";
import type { BackupRun, SystemCategory } from "@/lib/backup/types";
import { formatBytes } from "@/lib/metrics/catalog";
import { formatRelative } from "@/lib/i18n/format";
import { getActiveDictionary, getT } from "@/lib/i18n/server";
import { WidgetCard, WidgetEmpty } from "./WidgetCard";

const STATE_ICON: Record<SystemState, { icon: typeof CheckCircle2; className: string }> = {
  ok: { icon: CheckCircle2, className: "text-ok" },
  warning: { icon: TriangleAlert, className: "text-warn" },
  error: { icon: CircleAlert, className: "text-danger" },
  off: { icon: PauseCircle, className: "text-subtle" },
  running: { icon: Loader2, className: "animate-spin text-brand" },
  unset: { icon: CircleDashed, className: "text-subtle" },
};

/** Yedekler — üç sistemin durumu ve son çalışma; ayrıntı Yedekleme ekranında. */
export function BackupStatus({
  systems,
  runs,
  stale,
  readOnly = false,
}: {
  systems: SystemStatus[];
  runs: BackupRun[];
  stale: boolean;
  readOnly?: boolean;
}) {
  const t = getT();
  const dict = getActiveDictionary();
  const configured = systems.filter((system) => system.configured);
  const lastRun = runs.find((run) => run.kind === "backup");

  return (
    <WidgetCard
      title={t("dashboard.backups.title")}
      icon={Archive}
      href={readOnly ? undefined : "/backup"}
      linkLabel={t("dashboard.all")}
      aside={
        stale ? (
          <span className="shrink-0 text-xs font-medium text-warn">{t("dashboard.backups.stale")}</span>
        ) : undefined
      }
    >
      {configured.length === 0 ? (
        <WidgetEmpty>{t("dashboard.backups.empty")}</WidgetEmpty>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {systems.map((system) => {
              const style = STATE_ICON[system.state];
              const Icon = style.icon;
              return (
                <li key={system.category} className="flex items-center gap-2 py-2 text-sm first:pt-0 last:pb-0">
                  <Icon className={`size-4 shrink-0 ${style.className}`} aria-label={t(`backup.state.${system.state}`)} />
                  <span className="min-w-0 flex-1 truncate">{t(`backup.category.${system.category as SystemCategory}`)}</span>
                  {system.configured ? (
                    <>
                      {system.lastSize !== null && (
                        <span className="shrink-0 text-xs tabular-nums text-subtle">{formatBytes(system.lastSize)}</span>
                      )}
                      <time className="shrink-0 text-xs text-subtle">
                        {system.lastSuccessAt ? formatRelative(system.lastSuccessAt * 1000, dict) : t("backup.card.none")}
                      </time>
                    </>
                  ) : (
                    <span className="shrink-0 text-xs text-subtle">{t("backup.state.unset")}</span>
                  )}
                </li>
              );
            })}
          </ul>
          {lastRun && (
            <p className="mt-2 truncate border-t border-line pt-2 text-xs text-subtle" title={lastRun.detail}>
              {t("dashboard.backups.lastRun", {
                when: formatRelative((lastRun.finishedAt ?? lastRun.startedAt) * 1000, dict),
                status: t(`backup.runStatus.${lastRun.status}`),
              })}
            </p>
          )}
        </>
      )}
    </WidgetCard>
  );
}
