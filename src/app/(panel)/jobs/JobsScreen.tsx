"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import type { JobStatusRow } from "@/lib/jobs/types";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import { describeCron } from "@/lib/cron/friendly";

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function formatTime(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelative(ts: number | null): string {
  if (!ts) return "—";
  const diff = ts - Math.floor(Date.now() / 1000);
  const abs = Math.abs(diff);
  const unit = abs < 60 ? `${abs} sn` : abs < 3600 ? `${Math.round(abs / 60)} dk` : `${Math.round(abs / 3600)} sa`;
  return diff >= 0 ? `${unit} sonra` : `${unit} önce`;
}

const STATUS_STYLE: Record<string, string> = {
  başarılı: "bg-ok/15 text-ok",
  hata: "bg-danger/15 text-danger",
  çalışıyor: "bg-brand/15 text-brand",
  bekliyor: "bg-line text-subtle",
};

export function JobsScreen({
  initialJobs,
  canRun,
}: {
  initialJobs: JobStatusRow[];
  canRun: boolean;
}) {
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
        Zamanlamalar <strong className="text-ink">Ayarlar → Panel İşleri</strong> altından
        değiştirilir; değişiklik anında uygulanır, yeniden başlatma gerekmez.
      </p>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="rtable w-full min-w-[720px] text-sm">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-subtle">
            <tr>
              <th className="px-4 py-2.5 font-medium">İş</th>
              <th className="px-4 py-2.5 font-medium">Sıklık</th>
              <th className="px-4 py-2.5 font-medium">Durum</th>
              <th className="px-4 py-2.5 font-medium">Son çalışma</th>
              <th className="px-4 py-2.5 font-medium">Sonraki</th>
              <th className="px-4 py-2.5 font-medium">Çalışma/Hata</th>
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
                <td data-label="Sıklık" className="px-4 py-3 text-xs">
                  {/* Ham cron değil, insan diliyle. Aralık işleri zaten okunur. */}
                  {job.scheduleKind === "cron"
                    ? describeCron(job.scheduleText)
                    : job.scheduleText}
                </td>
                <td data-label="Durum" className="px-4 py-3">
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                      STATUS_STYLE[job.lastStatus] ?? "bg-line text-subtle"
                    }`}
                  >
                    {job.lastStatus}
                  </span>
                </td>
                <td data-label="Son çalışma" className="px-4 py-3 text-xs text-subtle">
                  {formatTime(job.lastFinishAt)}
                  {job.lastDurationMs !== null && (
                    <span className="ml-1 opacity-70">({job.lastDurationMs} ms)</span>
                  )}
                </td>
                <td data-label="Sonraki" className="px-4 py-3 text-xs text-subtle">
                  {formatRelative(job.nextRunAt)}
                </td>
                <td data-label="Çalışma/Hata" className="px-4 py-3 text-xs text-subtle">
                  {job.runCount} / <span className={job.failCount > 0 ? "text-danger" : ""}>{job.failCount}</span>
                </td>
                {canRun && (
                  <td data-label="" className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => run(job.key)}
                      disabled={busy === job.key}
                      title="Şimdi çalıştır"
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
