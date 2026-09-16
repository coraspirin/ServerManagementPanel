"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import type { JobStatusRow } from "@/lib/jobs/types";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import { describeCron } from "@/lib/cron/friendly";
import { useFormat, useT } from "@/lib/i18n/client";

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

/**
 * Durum veritabanında TÜRKÇE yazılı duruyor (eski kayıtlar da öyle). Değeri
 * değiştirmek bir migration demekti; onun yerine ekranda anahtara çevrilip
 * sözlükten okunuyor.
 */
const STATUS_KEY = {
  başarılı: "success",
  hata: "error",
  çalışıyor: "running",
  bekliyor: "waiting",
} as const;

const STATUS_STYLE: Record<string, string> = {
  başarılı: "bg-ok/15 text-ok",
  hata: "bg-danger/15 text-danger",
  çalışıyor: "bg-brand/15 text-brand",
  bekliyor: "bg-line text-subtle",
};

type T = ReturnType<typeof useT>;
type F = ReturnType<typeof useFormat>;

// Bileşenin DIŞINDA: `Date.now()` render sırasında çağrılırsa React'in saflık
// kuralı haklı olarak itiraz ediyor (react-hooks/purity).
function formatTime(ts: number | null, f: F): string {
  if (!ts) return "—";
  return f.dateTime(ts * 1000, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelative(ts: number | null, t: T): string {
  if (!ts) return "—";
  const diff = ts - Math.floor(Date.now() / 1000);
  const abs = Math.abs(diff);
  const value =
    abs < 60
      ? t("common.durationShort.second", { count: abs })
      : abs < 3600
        ? t("common.durationShort.minute", { count: Math.round(abs / 60) })
        : t("common.durationShort.hour", { count: Math.round(abs / 3600) });
  return diff >= 0 ? t("jobs.screen.inSeconds", { value }) : t("jobs.screen.agoSeconds", { value });
}

export function JobsScreen({
  initialJobs,
  canRun,
}: {
  initialJobs: JobStatusRow[];
  canRun: boolean;
}) {
  const t = useT();
  const f = useFormat();
  const [jobs, setJobs] = useState(initialJobs);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string) {
    setBusy(key);
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: JSON.stringify({ key }),
      });
      const data = await response.json();
      if (data.jobs) setJobs(data.jobs);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-subtle">
        {(() => {
          // Cümlenin ortasındaki ayar yolu KALIN. Yer tutucu doldurulmadan
          // bırakılıp ona göre bölünüyor: cümleyi iki ayrı anahtara kesmek,
          // sözdizimi farklı bir dilde parçaları yanlış sıraya sokardı.
          const [oncesi, sonrasi] = t("jobs.screen.intro").split("{settings}");
          return (
            <>
              {oncesi}
              <strong className="text-ink">{t("jobs.screen.introSettings")}</strong>
              {sonrasi}
            </>
          );
        })()}
      </p>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="rtable w-full min-w-[720px] text-sm">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-subtle">
            <tr>
              <th className="px-4 py-2.5 font-medium">{t("jobs.screen.colJob")}</th>
              <th className="px-4 py-2.5 font-medium">{t("jobs.screen.colSchedule")}</th>
              <th className="px-4 py-2.5 font-medium">{t("jobs.screen.colStatus")}</th>
              <th className="px-4 py-2.5 font-medium">{t("jobs.screen.colLastRun")}</th>
              <th className="px-4 py-2.5 font-medium">{t("jobs.screen.colNext")}</th>
              <th className="px-4 py-2.5 font-medium">{t("jobs.screen.colRuns")}</th>
              {canRun && <th className="px-4 py-2.5" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {jobs.map((job) => (
              <tr key={job.key}>
                <td data-label="" className="px-4 py-3">
                  <div className="font-medium">{job.label}</div>
                  <div className="text-xs text-subtle">{job.description}</div>
                  {job.lastError && (
                    <div className="mt-1 text-xs text-danger">{job.lastError}</div>
                  )}
                </td>
                <td data-label={t("jobs.screen.colSchedule")} className="px-4 py-3 text-xs">
                  {/* Ham cron değil, insan diliyle. Aralık işleri zaten okunur. */}
                  {job.scheduleKind === "cron"
                    ? describeCron(job.scheduleText)
                    : job.scheduleText}
                </td>
                <td data-label={t("jobs.screen.colStatus")} className="px-4 py-3">
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                      STATUS_STYLE[job.lastStatus] ?? "bg-line text-subtle"
                    }`}
                  >
                    {job.lastStatus in STATUS_KEY
                      ? t(`jobs.status.${STATUS_KEY[job.lastStatus as keyof typeof STATUS_KEY]}`)
                      : job.lastStatus}
                  </span>
                </td>
                <td data-label={t("jobs.screen.colLastRun")} className="px-4 py-3 text-xs text-subtle">
                  {formatTime(job.lastFinishAt, f)}
                  {job.lastDurationMs !== null && (
                    <span className="ml-1 opacity-70">({job.lastDurationMs} ms)</span>
                  )}
                </td>
                <td data-label={t("jobs.screen.colNext")} className="px-4 py-3 text-xs text-subtle">
                  {formatRelative(job.nextRunAt, t)}
                </td>
                <td data-label={t("jobs.screen.colRuns")} className="px-4 py-3 text-xs text-subtle">
                  {job.runCount} / <span className={job.failCount > 0 ? "text-danger" : ""}>{job.failCount}</span>
                </td>
                {canRun && (
                  <td data-label="" className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => run(job.key)}
                      disabled={busy === job.key}
                      title={t("jobs.screen.runNow")}
                      className="rounded border border-line p-1.5 text-subtle transition-colors hover:text-brand disabled:opacity-50"
                    >
                      <Play className="size-3.5" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
