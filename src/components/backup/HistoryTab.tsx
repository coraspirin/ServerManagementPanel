"use client";

import { Fragment, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, History } from "lucide-react";

import type { BackupRun, Category, RunKind, RunStatus } from "@/lib/backup/types";
import { useFormat, useT } from "@/lib/i18n/client";
import { api, cardClass, formatBytes, inputClass, smallButtonClass } from "./client";
import { RunStatusBadge, SectionHeader } from "./parts";

const PAGE = 25;

export function HistoryTab({ revision, jobId, compact = false }: { revision: number; jobId?: number; compact?: boolean }) {
  const t = useT();
  const f = useFormat();
  const [category, setCategory] = useState<Category | "">("");
  const [kind, setKind] = useState<RunKind | "">("");
  const [status, setStatus] = useState<RunStatus | "">("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ runs: BackupRun[]; total: number } | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [log, setLog] = useState<string>("");

  useEffect(() => {
    const params = new URLSearchParams({ limit: String(compact ? 10 : PAGE), offset: String(page * PAGE) });
    if (jobId) params.set("jobId", String(jobId));
    if (category) params.set("category", category);
    if (kind) params.set("kind", kind);
    if (status) params.set("status", status);
    let cancelled = false;
    api<{ runs: BackupRun[]; total: number }>(`/api/backup/runs?${params}`)
      .then((payload) => !cancelled && setData(payload))
      .catch(() => !cancelled && setData({ runs: [], total: 0 }));
    return () => {
      cancelled = true;
    };
  }, [jobId, category, kind, status, page, revision, compact]);

  const expand = async (run: BackupRun) => {
    if (open === run.id) {
      setOpen(null);
      return;
    }
    setOpen(run.id);
    setLog("");
    try {
      const payload = await api<{ run: BackupRun & { log: string } }>(`/api/backup/runs/${run.id}`);
      setLog(payload.run.log);
    } catch {
      setLog("");
    }
  };

  const label = (run: BackupRun) =>
    run.category === "custom" ? run.jobName : t(`backup.category.${run.category}`);
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;

  return (
    <section className={cardClass}>
      <SectionHeader
        icon={History}
        title={compact ? t("backup.history.recent") : t("backup.tabs.history")}
        aside={
          !compact && (
            <div className="flex flex-wrap gap-2">
              <select
                className={`${inputClass} w-auto`}
                value={category}
                onChange={(event) => {
                  setCategory(event.target.value as Category | "");
                  setPage(0);
                }}
                aria-label={t("backup.history.filterSystem")}
              >
                <option value="">{t("backup.history.allSystems")}</option>
                {(["docker", "os", "database", "custom"] as const).map((value) => (
                  <option key={value} value={value}>
                    {t(`backup.category.${value}`)}
                  </option>
                ))}
              </select>
              <select
                className={`${inputClass} w-auto`}
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value as RunKind | "");
                  setPage(0);
                }}
                aria-label={t("backup.history.filterKind")}
              >
                <option value="">{t("backup.history.allKinds")}</option>
                {(["backup", "restore", "verify"] as const).map((value) => (
                  <option key={value} value={value}>
                    {t(`backup.runKind.${value}`)}
                  </option>
                ))}
              </select>
              <select
                className={`${inputClass} w-auto`}
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as RunStatus | "");
                  setPage(0);
                }}
                aria-label={t("backup.history.filterStatus")}
              >
                <option value="">{t("backup.history.allStatuses")}</option>
                {(["ok", "warning", "error", "cancelled", "running"] as const).map((value) => (
                  <option key={value} value={value}>
                    {t(`backup.runStatus.${value}`)}
                  </option>
                ))}
              </select>
            </div>
          )
        }
      />

      {data === null ? (
        <p className="px-5 py-8 text-center text-sm text-subtle">{t("backup.common.loading")}</p>
      ) : data.runs.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-subtle">{t("backup.history.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-subtle">
              <tr className="border-b border-line">
                <th className="w-6 px-3 py-2" />
                <th className="px-3 py-2 font-medium">{t("backup.history.when")}</th>
                {!jobId && <th className="px-3 py-2 font-medium">{t("backup.history.system")}</th>}
                <th className="px-3 py-2 font-medium">{t("backup.history.kind")}</th>
                <th className="px-3 py-2 font-medium">{t("backup.history.status")}</th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">{t("backup.history.detail")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("backup.history.size")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("backup.history.duration")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.runs.map((run) => (
                <Fragment key={run.id}>
                  <tr className="cursor-pointer hover:bg-canvas" onClick={() => void expand(run)}>
                    <td className="px-3 py-2 text-subtle">
                      {open === run.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{f.dateTime(run.startedAt * 1000)}</td>
                    {!jobId && <td className="whitespace-nowrap px-3 py-2">{label(run)}</td>}
                    <td className="whitespace-nowrap px-3 py-2 text-subtle">{t(`backup.runKind.${run.kind}`)}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <RunStatusBadge status={run.status} />
                    </td>
                    <td className="hidden max-w-md truncate px-3 py-2 text-xs text-subtle md:table-cell" title={run.detail}>
                      {run.anomaly && <span className="mr-1 text-warn">⚠</span>}
                      {run.detail}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-subtle">
                      {run.kind === "backup" && run.status !== "error" ? `+${formatBytes(run.bytesAdded)}` : ""}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-subtle">
                      {run.durationMs > 0 ? f.duration(Math.round(run.durationMs / 1000)) : ""}
                    </td>
                  </tr>
                  {open === run.id && (
                    <tr>
                      <td colSpan={8} className="bg-canvas px-5 py-3 text-xs">
                        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
                          <dt className="text-subtle">{t("backup.history.detail")}</dt>
                          <dd className="whitespace-pre-wrap">{run.detail || "—"}</dd>
                          {run.anomaly && (
                            <>
                              <dt className="text-subtle">{t("backup.history.anomaly")}</dt>
                              <dd className="text-warn">{run.anomaly}</dd>
                            </>
                          )}
                          {run.snapshotId && (
                            <>
                              <dt className="text-subtle">{t("backup.history.snapshot")}</dt>
                              <dd className="font-mono">{run.snapshotId.slice(0, 12)}</dd>
                            </>
                          )}
                          {run.kind === "backup" && run.filesTotal > 0 && (
                            <>
                              <dt className="text-subtle">{t("backup.history.files")}</dt>
                              <dd>
                                {t("backup.history.filesValue", {
                                  total: f.number(run.filesTotal),
                                  added: f.number(run.filesNew),
                                  changed: f.number(run.filesChanged),
                                  size: formatBytes(run.bytesProcessed),
                                })}
                              </dd>
                            </>
                          )}
                          <dt className="text-subtle">{t("backup.history.actor")}</dt>
                          <dd>
                            {run.actor}
                            {run.attempt > 1 && ` · ${t("backup.history.attempt", { count: run.attempt })}`}
                          </dd>
                        </dl>
                        {log && (
                          <pre className="mt-2 max-h-64 overflow-auto rounded border border-line bg-surface p-2 font-mono text-[11px] thin-scrollbar">
                            {log}
                          </pre>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!compact && data && data.total > PAGE && (
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-2 text-xs">
          <button type="button" disabled={page === 0} className={smallButtonClass} onClick={() => setPage(page - 1)}>
            {t("backup.common.prev")}
          </button>
          <span className="text-subtle">
            {page + 1} / {pages}
          </span>
          <button type="button" disabled={page + 1 >= pages} className={smallButtonClass} onClick={() => setPage(page + 1)}>
            {t("backup.common.next")}
          </button>
        </div>
      )}
    </section>
  );
}
