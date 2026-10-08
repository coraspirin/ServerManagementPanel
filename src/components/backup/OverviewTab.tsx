"use client";

import { useState } from "react";
import { BarChart3, Boxes, Database, HardDrive, Play, Server, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";

import type { BackupOverview, SystemStatus } from "@/lib/backup/overview";
import type { LiveProgress, SystemCategory } from "@/lib/backup/types";
import { useFormat, useT } from "@/lib/i18n/client";
import { api, buttonClass, cardClass, formatBytes, primaryButtonClass, smallButtonClass } from "./client";
import { CustomJobs } from "./CustomJobs";
import { LiveProgressCard, Notice, SectionHeader, StateBadge } from "./parts";

const ICONS: Record<SystemCategory, typeof Boxes> = { docker: Boxes, os: Server, database: Database };

export function OverviewTab({
  overview,
  live,
  needsSetup,
  onSetup,
  onOpen,
  onChanged,
}: {
  overview: BackupOverview;
  live: LiveProgress[];
  needsSetup: boolean;
  onSetup: () => void;
  onOpen: (tab: SystemCategory) => void;
  onChanged: () => void;
}) {
  const t = useT();
  const f = useFormat();
  const [error, setError] = useState<string | null>(null);

  const labelOf = (jobId: number) => {
    const system = overview.systems.find((entry) => entry.jobId === jobId);
    if (system) return t(`backup.category.${system.category as SystemCategory}`);
    return overview.custom.find((entry) => entry.jobId === jobId)?.name ?? `#${jobId}`;
  };

  const runNow = async (jobId: number) => {
    setError(null);
    try {
      await api(`/api/backup/jobs/${jobId}/run`, "POST");
      onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  const stored = overview.repos.reduce((total, repo) => total + (repo.stats?.storedBytes ?? 0), 0);
  const totalRuns = overview.rate.ok + overview.rate.failed;
  const rate = totalRuns > 0 ? Math.round((overview.rate.ok / totalRuns) * 100) : null;
  const lastVerify = overview.repos
    .map((repo) => repo.lastVerifyAt)
    .filter((value): value is number => value !== null)
    .sort((a, b) => b - a)[0];

  const warnings = collectWarnings(overview, t);

  return (
    <div className="space-y-5">
      {needsSetup && (
        <section className={`${cardClass} p-6`}>
          <div className="flex flex-wrap items-start gap-4">
            <Sparkles className="size-8 shrink-0 text-brand" aria-hidden />
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold">{t("backup.setup.heroTitle")}</h2>
              <p className="mt-1 text-sm text-subtle">{t("backup.setup.heroText")}</p>
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-subtle">
                <li>{t("backup.setup.heroStep1")}</li>
                <li>{t("backup.setup.heroStep2")}</li>
                <li>{t("backup.setup.heroStep3")}</li>
              </ol>
            </div>
            <button type="button" onClick={onSetup} className={primaryButtonClass}>
              <Sparkles className="size-4" aria-hidden /> {t("backup.setup.start")}
            </button>
          </div>
        </section>
      )}

      {error && <Notice tone="error">{error}</Notice>}

      {live.length > 0 && (
        <div className="space-y-3">
          {live.map((run) => (
            <LiveProgressCard key={run.runId} run={run} title={labelOf(run.jobId)} />
          ))}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {overview.systems.map((system) => (
          <SystemCard
            key={system.category}
            system={system}
            running={live.some((run) => run.jobId === system.jobId && !run.done)}
            onRun={() => system.jobId !== null && void runNow(system.jobId)}
            onOpen={() => onOpen(system.category as SystemCategory)}
            onSetup={onSetup}
          />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={HardDrive} label={t("backup.kpi.stored")} value={formatBytes(stored)} />
        <Kpi
          icon={ShieldCheck}
          label={t("backup.kpi.rate")}
          value={rate === null ? "—" : `%${rate}`}
          hint={t("backup.kpi.rateHint", { ok: overview.rate.ok, failed: overview.rate.failed })}
        />
        <Kpi icon={HardDrive} label={t("backup.kpi.locations")} value={String(overview.repos.length)} />
        <Kpi
          icon={ShieldCheck}
          label={t("backup.kpi.lastVerify")}
          value={lastVerify ? f.relative(lastVerify * 1000) : t("backup.kpi.never")}
        />
      </div>

      {warnings.length > 0 && (
        <section className={cardClass}>
          <SectionHeader icon={TriangleAlert} title={t("backup.warnings.title")} />
          <ul className="divide-y divide-line">
            {warnings.map((warning) => (
              <li key={warning.key} className="flex items-start gap-2 px-5 py-2.5 text-sm">
                <TriangleAlert
                  className={`mt-0.5 size-4 shrink-0 ${warning.tone === "error" ? "text-danger" : "text-warn"}`}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">{warning.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={cardClass}>
        <SectionHeader icon={BarChart3} title={t("backup.chart.title")} />
        <DailyChart daily={overview.daily} />
      </section>

      <CustomJobs statuses={overview.custom} jobs={overview.customJobs} locations={overview.repos} live={live} onChanged={onChanged} />
    </div>
  );
}

function SystemCard({
  system,
  running,
  onRun,
  onOpen,
  onSetup,
}: {
  system: SystemStatus;
  running: boolean;
  onRun: () => void;
  onOpen: () => void;
  onSetup: () => void;
}) {
  const t = useT();
  const f = useFormat();
  const category = system.category as SystemCategory;
  const Icon = ICONS[category];
  const border =
    system.state === "error"
      ? "border-danger/50"
      : system.state === "warning"
        ? "border-warn/50"
        : system.state === "ok"
          ? "border-ok/40"
          : "border-line";

  return (
    <section className={`flex flex-col rounded-lg border bg-surface p-4 ${border}`}>
      <div className="flex items-center gap-2">
        <Icon className="size-5 text-subtle" aria-hidden />
        <h3 className="flex-1 font-semibold">{t(`backup.category.${category}`)}</h3>
        <StateBadge state={running ? "running" : system.state} />
      </div>

      {system.configured ? (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-subtle">{t("backup.card.lastSuccess")}</dt>
          <dd className="text-right">{system.lastSuccessAt ? f.relative(system.lastSuccessAt * 1000) : t("backup.card.none")}</dd>
          <dt className="text-subtle">{t("backup.card.next")}</dt>
          <dd className="text-right">
            {system.nextRunAt ? f.dateTime(system.nextRunAt * 1000) : t("backup.card.manual")}
            {system.retryAt && <span className="block text-xs text-warn">{t("backup.card.retrying")}</span>}
          </dd>
          <dt className="text-subtle">{t("backup.card.size")}</dt>
          <dd className="text-right">{formatBytes(system.lastSize)}</dd>
          <dt className="text-subtle">{t("backup.card.items")}</dt>
          <dd className="text-right">{system.itemCount}</dd>
          <dt className="text-subtle">{t("backup.card.location")}</dt>
          <dd className="truncate text-right" title={system.repoName}>
            {system.repoName}
          </dd>
        </dl>
      ) : (
        <p className="mt-3 flex-1 text-sm text-subtle">{t(`backup.card.unset.${category}`)}</p>
      )}

      {system.configured && system.state === "error" && system.lastDetail && (
        <p className="mt-2 line-clamp-3 text-xs text-danger" title={system.lastDetail}>
          {system.lastDetail}
        </p>
      )}
      {system.lastAnomaly && <p className="mt-2 text-xs text-warn">{system.lastAnomaly}</p>}

      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        {system.configured ? (
          <>
            <button type="button" disabled={running} onClick={onRun} className={primaryButtonClass}>
              <Play className="size-4" aria-hidden /> {t("backup.actions.runNow")}
            </button>
            <button type="button" onClick={onOpen} className={buttonClass}>
              {t("backup.actions.details")}
            </button>
          </>
        ) : (
          <button type="button" onClick={onSetup} className={smallButtonClass}>
            {t("backup.actions.setup")}
          </button>
        )}
      </div>
    </section>
  );
}

function Kpi({ icon: Icon, label, value, hint }: { icon: typeof Boxes; label: string; value: string; hint?: string }) {
  return (
    <div className={`${cardClass} p-4`}>
      <div className="flex items-center gap-2 text-xs text-subtle">
        <Icon className="size-3.5" aria-hidden /> {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-subtle">{hint}</div>}
    </div>
  );
}

/** 30 günlük eklenen veri — basit SVG çubuklar; başarısız gün kırmızı nokta. */
function DailyChart({ daily }: { daily: BackupOverview["daily"] }) {
  const t = useT();
  const f = useFormat();
  // Sayfa açıldığı anın günü; render sırasında saat okumak (saflık kuralı) yerine bir kez.
  const [today] = useState(() => Math.floor(Date.now() / 86_400_000) * 86_400);
  if (daily.length === 0) return <p className="px-5 py-8 text-center text-sm text-subtle">{t("backup.chart.empty")}</p>;

  const days = Array.from({ length: 30 }, (_, index) => today - (29 - index) * 86_400);
  const byDay = new Map(daily.map((entry) => [entry.day, entry]));
  const max = Math.max(1, ...daily.map((entry) => entry.bytes));

  return (
    <div className="px-5 py-4">
      <div className="flex h-32 items-end gap-[3px]" role="img" aria-label={t("backup.chart.title")}>
        {days.map((day) => {
          const entry = byDay.get(day);
          const height = entry ? Math.max(3, (entry.bytes / max) * 100) : 0;
          return (
            <div
              key={day}
              className="relative flex h-full flex-1 items-end"
              title={`${f.date(day * 1000)} · ${entry ? formatBytes(entry.bytes) : "—"}${entry?.failed ? ` · ${t("backup.chart.failed", { count: entry.failed })}` : ""}`}
            >
              <div className="w-full rounded-t bg-brand/70" style={{ height: `${height}%` }} />
              {entry && entry.failed > 0 && <span className="absolute -top-1 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-danger" />}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-subtle">
        <span>{f.date(days[0] * 1000)}</span>
        <span>{t("backup.chart.max", { size: formatBytes(max) })}</span>
        <span>{f.date(today * 1000)}</span>
      </div>
    </div>
  );
}

type Warning = { key: string; text: string; tone: "error" | "warn" };

function collectWarnings(overview: BackupOverview, t: ReturnType<typeof useT>): Warning[] {
  const warnings: Warning[] = [];
  for (const system of overview.systems) {
    if (system.configured && system.overdue) {
      warnings.push({
        key: `overdue-${system.category}`,
        tone: "error",
        text: t("backup.warnings.overdue", { name: t(`backup.category.${system.category as SystemCategory}`) }),
      });
    }
  }
  for (const repo of overview.repos) {
    if (!repo.passwordReadable) {
      warnings.push({ key: `pw-${repo.id}`, tone: "error", text: t("backup.warnings.password", { name: repo.name }) });
    }
    if (repo.lastError) {
      warnings.push({
        key: `err-${repo.id}`,
        tone: "error",
        text: /locked/i.test(repo.lastError)
          ? t("backup.warnings.locked", { name: repo.name })
          : t("backup.warnings.repoError", { name: repo.name, error: repo.lastError.slice(0, 200) }),
      });
    }
    if (repo.lastVerifyStatus === "error") {
      warnings.push({ key: `verify-${repo.id}`, tone: "error", text: t("backup.warnings.verify", { name: repo.name }) });
    }
    const stats = repo.stats;
    if (stats?.freeBytes && stats.totalBytes && stats.freeBytes / stats.totalBytes < 0.1) {
      warnings.push({
        key: `space-${repo.id}`,
        tone: "warn",
        text: t("backup.warnings.space", { name: repo.name, free: formatBytes(stats.freeBytes) }),
      });
    }
  }
  return warnings;
}
