import { Archive, CheckCircle2, CircleAlert, Loader2 } from "lucide-react";
import type { BackupRun } from "@/lib/backup/types";
import { formatBytes } from "@/lib/metrics/catalog";
import { formatRelative } from "@/lib/i18n/format";
import { getActiveDictionary, getT } from "@/lib/i18n/server";
import { WidgetCard, WidgetEmpty } from "./WidgetCard";

/** Yedekler — son çalışmalar; ayrıntı ve geri yükleme Yedekleme ekranında. */
export function BackupStatus({
  runs,
  stale,
  readOnly = false,
}: {
  runs: BackupRun[];
  stale: boolean;
  readOnly?: boolean;
}) {
  const t = getT();
  const dict = getActiveDictionary();

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
      {runs.length === 0 ? (
        <WidgetEmpty>{t("dashboard.backups.empty")}</WidgetEmpty>
      ) : (
        <ul className="divide-y divide-line">
          {runs.map((run) => (
            <li key={run.id} className="flex items-center gap-2 py-2 text-sm first:pt-0 last:pb-0">
              {run.status === "ok" ? (
                <CheckCircle2 className="size-4 shrink-0 text-ok" aria-label={t("dashboard.backups.ok")} />
              ) : run.status === "error" ? (
                <CircleAlert className="size-4 shrink-0 text-danger" aria-label={t("dashboard.backups.error")} />
              ) : (
                <Loader2 className="size-4 shrink-0 animate-spin text-brand" aria-label={t("dashboard.backups.running")} />
              )}
              <span className="min-w-0 flex-1 truncate" title={run.detail || run.jobName}>
                {run.jobName}
              </span>
              {run.status === "ok" && (
                <span className="shrink-0 text-xs tabular-nums text-subtle">+{formatBytes(run.bytesAdded)}</span>
              )}
              <time className="shrink-0 text-xs text-subtle">
                {formatRelative((run.finishedAt ?? run.startedAt) * 1000, dict)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}
