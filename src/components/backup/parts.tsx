"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, CircleDashed, Loader2, PauseCircle, Square, TriangleAlert } from "lucide-react";

import type { SystemState } from "@/lib/backup/overview";
import type { LiveProgress, RunStatus } from "@/lib/backup/types";
import { useFormat, useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import { api, formatBytes, smallButtonClass } from "./client";

const STATE_STYLE: Record<SystemState, { className: string; icon: typeof CheckCircle2; label: MessageKey }> = {
  ok: { className: "text-ok", icon: CheckCircle2, label: "backup.state.ok" },
  warning: { className: "text-warn", icon: TriangleAlert, label: "backup.state.warning" },
  error: { className: "text-danger", icon: CircleAlert, label: "backup.state.error" },
  off: { className: "text-subtle", icon: PauseCircle, label: "backup.state.off" },
  running: { className: "text-brand", icon: Loader2, label: "backup.state.running" },
  unset: { className: "text-subtle", icon: CircleDashed, label: "backup.state.unset" },
};

export function StateBadge({ state, label }: { state: SystemState; label?: string }) {
  const t = useT();
  const style = STATE_STYLE[state];
  const Icon = style.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${style.className}`}>
      <Icon className={`size-3.5 ${state === "running" ? "animate-spin" : ""}`} aria-hidden />
      {label ?? t(style.label)}
    </span>
  );
}

const RUN_STATE: Record<RunStatus, SystemState> = {
  running: "running",
  ok: "ok",
  warning: "warning",
  error: "error",
  cancelled: "off",
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const t = useT();
  return <StateBadge state={RUN_STATE[status]} label={t(`backup.runStatus.${status}`)} />;
}

/** Çalışan bir koşunun ilerlemesi: faz, çubuk, hız, kalan süre, iptal. */
export function LiveProgressCard({ run, title }: { run: LiveProgress; title: string }) {
  const t = useT();
  const f = useFormat();
  const [cancelling, setCancelling] = useState(false);
  // Geçen süre her saniye güncellensin (ilerleme olayı gelmese de).
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (run.done) return;
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, [run.done]);
  const elapsed = Math.max(1, now - run.startedAt);
  const speed = run.bytesDone > 0 ? run.bytesDone / elapsed : 0;
  const percent = run.percent === null ? null : Math.max(0, Math.min(100, run.percent));

  return (
    <div className="rounded-lg border border-brand/40 bg-brand/5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {run.done ? <RunStatusBadge status={run.status} /> : <StateBadge state="running" label={t(`backup.phase.${run.phase}`)} />}
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-subtle">{t(`backup.runKind.${run.kind}`)}</span>
        {!run.done && (
          <button
            type="button"
            disabled={cancelling}
            onClick={async () => {
              if (!confirm(t("backup.live.confirmCancel"))) return;
              setCancelling(true);
              try {
                await api(`/api/backup/runs/${run.runId}`, "DELETE");
              } catch {
                setCancelling(false);
              }
            }}
            className={`${smallButtonClass} ml-auto hover:border-danger hover:text-danger`}
          >
            <Square className="size-3" aria-hidden /> {t("backup.live.cancel")}
          </button>
        )}
      </div>

      {!run.done && (
        <>
          <div
            className="mt-3 h-2 overflow-hidden rounded-full bg-line"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? undefined}
          >
            <div
              className={`h-full rounded-full bg-brand transition-[width] duration-700 ${percent === null ? "w-1/3 animate-pulse" : ""}`}
              style={percent === null ? undefined : { width: `${percent}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle">
            {percent !== null && <span className="font-medium text-ink">%{Math.floor(percent)}</span>}
            {run.totalFiles > 0 && (
              <span>{t("backup.live.files", { done: f.number(run.filesDone), total: f.number(run.totalFiles) })}</span>
            )}
            {run.totalBytes > 0 && (
              <span>{t("backup.live.bytes", { done: formatBytes(run.bytesDone), total: formatBytes(run.totalBytes) })}</span>
            )}
            {speed > 0 && <span>{t("backup.live.speed", { speed: formatBytes(speed) })}</span>}
            {run.secondsRemaining !== null && run.secondsRemaining > 0 && (
              <span>{t("backup.live.remaining", { time: f.duration(run.secondsRemaining) })}</span>
            )}
            <span>{t("backup.live.elapsed", { time: f.duration(elapsed) })}</span>
          </div>
          {(run.currentFiles.length > 0 || run.message) && (
            <p className="mt-1 truncate font-mono text-[11px] text-subtle" title={run.currentFiles[0] ?? run.message}>
              {run.currentFiles[0] ?? run.message}
            </p>
          )}
        </>
      )}
      {run.done && run.message && <p className="mt-2 text-xs text-subtle">{run.message}</p>}
    </div>
  );
}

/** Kart başlığı. */
export function SectionHeader({
  icon: Icon,
  title,
  aside,
}: {
  icon: typeof CheckCircle2;
  title: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 text-subtle" aria-hidden />
        {title}
      </h2>
      {aside}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-start gap-3 py-2 ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <input
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-xs text-subtle">{hint}</span>}
      </span>
    </label>
  );
}

export function Notice({ tone, children }: { tone: "error" | "ok" | "info" | "warn"; children: React.ReactNode }) {
  const style =
    tone === "error"
      ? "border-danger/40 bg-danger/5 text-danger"
      : tone === "ok"
        ? "border-ok/40 bg-ok/5 text-ok"
        : tone === "warn"
          ? "border-warn/40 bg-warn/5 text-warn"
          : "border-line bg-canvas text-subtle";
  return <div className={`rounded-md border px-3 py-2 text-sm ${style}`}>{children}</div>;
}
