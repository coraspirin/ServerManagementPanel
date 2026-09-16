"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Database,
  FolderTree,
  HardDrive,
  History,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  XCircle,
} from "lucide-react";
import { Modal } from "@/components/Modal";
import { CronEditor } from "@/components/settings/CronEditor";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import {
  type BackupJob,
  type BackupRepo,
  type BackupRun,
  type Snapshot,
  type SourceKind,
} from "@/lib/backup/types";
import { useFormat, useT } from "@/lib/i18n/client";
import { Rich } from "@/lib/i18n/rich";
import type { MessageKey } from "@/lib/i18n/translate";

const SOURCE_LABEL: Record<SourceKind, MessageKey> = {
  volume: "backup.source.volume",
  host_dir: "backup.source.host_dir",
  panel_db: "backup.source.panel_db",
};

const REPO_LABEL: Record<BackupRepo["kind"], MessageKey> = {
  local: "backup.repoKind.local",
  rclone: "backup.repoKind.rclone",
  s3: "backup.repoKind.s3",
};

/**
 * M3.4 — yedekleme motoru arayüzü.
 *
 * Ekranın taşıdığı en önemli mesaj teknik değil: **depo parolası panelin
 * dışında da saklanmalı.** Panel onu MASTER_KEY ile şifreliyor; anahtar
 * kaybolursa panel parolayı çözemez ve yedekler panel üzerinden okunamaz.
 * restic deposu panelsiz de açılabilir — yeter ki parola elde olsun.
 */

type Payload = { repos: BackupRepo[]; jobs: BackupJob[]; runs: BackupRun[] };

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[index]}`;
}


const SOURCE_ICON: Record<SourceKind, typeof Database> = {
  volume: HardDrive,
  host_dir: FolderTree,
  panel_db: Database,
};

const inputClass =
  "mt-1 w-full rounded-md border border-line bg-canvas px-3 py-1.5 text-sm outline-none focus:border-brand";

export function BackupScreen({
  initial,
  volumes,
  containers,
}: {
  initial: Payload;
  volumes: string[];
  containers: string[];
}) {
  const t = useT();
  const f = useFormat();
  const when = (ts: number | null) => (ts === null ? t("users.never") : f.dateTime(ts * 1000));
  const [data, setData] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [repoDraft, setRepoDraft] = useState<Partial<BackupRepo> & { password?: string; env?: string } | null>(null);
  const [jobDraft, setJobDraft] = useState<Partial<BackupJob> | null>(null);
  const [snapshotsFor, setSnapshotsFor] = useState<BackupJob | null>(null);

  async function call(path: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(path, {
        method,
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const payload = (await response.json()) as Record<string, unknown>;

      if (payload.repos) {
        setData({
          repos: payload.repos as BackupRepo[],
          jobs: payload.jobs as BackupJob[],
          runs: (payload.runs as BackupRun[]) ?? data.runs,
        });
      }
      if (!response.ok) {
        setError(String(payload.error ?? t("common.errors.actionFailed")));
        return false;
      }
      if (payload.message) setNotice(String(payload.message));
      // `ok: false` HTTP 200 ile de gelebilir: yedekleme çalıştı ama başarısız
      // oldu. Bu bir istek hatası değil, bir sonuç.
      if (payload.ok === false) {
        setError(String(payload.message ?? t("backup.failed")));
        return false;
      }
      return true;
    } catch {
      setError(t("common.errors.network"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const unreadable = data.repos.filter((repo) => repo.hasPassword && !repo.passwordReadable);

  return (
    <div className="space-y-5">
      {unreadable.length > 0 && (
        <p className="rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger">
          <Rich
            text={t("backup.unreadable")}
            values={{ names: <strong>{unreadable.map((repo) => repo.name).join(", ")}</strong> }}
          />
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-danger/10 px-4 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg bg-ok/10 px-4 py-2.5 text-sm text-ok">{notice}</p>
      )}

      {/* --- Depolar --- */}
      <section className="rounded-lg border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Archive className="size-4 text-subtle" aria-hidden />
            {t("backup.repos.title")}
            <span className="font-normal text-subtle">{data.repos.length}</span>
          </h2>
          <button
            type="button"
            onClick={() => setRepoDraft({ kind: "local", name: "", location: "", password: "", env: "" })}
            className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand"
          >
            <Plus className="size-4" /> {t("backup.repos.add")}
          </button>
        </div>

        {data.repos.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-subtle">
            {t("backup.repos.empty")}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {data.repos.map((repo) => (
              <li key={repo.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {repo.name}
                    <span className="rounded border border-line px-1 text-[10px] font-normal text-subtle">
                      {t(REPO_LABEL[repo.kind])}
                    </span>
                    {repo.initialized ? (
                      <span className="flex items-center gap-1 text-[11px] font-normal text-ok">
                        <CheckCircle2 className="size-3" aria-hidden /> {t("backup.repos.ready")}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[11px] font-normal text-warn">
                        <AlertTriangle className="size-3" aria-hidden /> {t("backup.repos.notInitialized")}
                      </span>
                    )}
                  </div>
                  <code className="block truncate font-mono text-[11px] text-subtle">
                    {repo.location}
                  </code>
                  <span className="text-[11px] text-subtle">
                    {t("backup.repos.meta", { jobs: repo.jobCount, when: when(repo.lastCheckAt) })}
                    {repo.lastError && ` · ${repo.lastError}`}
                  </span>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void call("/api/backup/repos", "POST", { action: "check", id: repo.id })}
                    className="rounded-md border border-line px-2.5 py-1.5 text-xs transition-colors hover:border-brand disabled:opacity-50"
                  >
                    {t("backup.repos.test")}
                  </button>
                  {!repo.initialized && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void call("/api/backup/repos", "POST", { action: "init", id: repo.id })}
                      className="rounded-md border border-line px-2.5 py-1.5 text-xs transition-colors hover:border-brand disabled:opacity-50"
                    >
                      {t("backup.repos.init")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setRepoDraft({ ...repo, password: "", env: "" })}
                    className="rounded-md border border-line px-2.5 py-1.5 text-xs transition-colors hover:border-brand"
                  >
                    {t("common.actions.edit")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (confirm(t("backup.repos.confirmDelete", { name: repo.name }))) {
                        void call(`/api/backup/repos?id=${repo.id}`, "DELETE");
                      }
                    }}
                    className="rounded border border-line p-1.5 text-subtle transition-colors hover:text-danger disabled:opacity-50"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --- İşler --- */}
      <section className="rounded-lg border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <HardDrive className="size-4 text-subtle" aria-hidden />
            {t("backup.jobs.title")}
            <span className="font-normal text-subtle">{data.jobs.length}</span>
          </h2>
          <button
            type="button"
            disabled={data.repos.length === 0}
            title={data.repos.length === 0 ? t("backup.jobs.needRepo") : undefined}
            onClick={() =>
              setJobDraft({
                name: "",
                repoId: data.repos[0]?.id,
                sourceKind: "volume",
                source: volumes[0] ?? "",
                scheduleCron: "0 3 * * *",
                quiesce: "",
                excludes: "",
                keepDaily: 7,
                keepWeekly: 4,
                keepMonthly: 6,
                enabled: true,
              })
            }
            className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand disabled:opacity-50"
          >
            <Plus className="size-4" /> {t("backup.jobs.add")}
          </button>
        </div>

        {data.jobs.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-subtle">
            {t("backup.jobs.empty")}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {data.jobs.map((job) => {
              const Icon = SOURCE_ICON[job.sourceKind];
              return (
                <li key={job.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <Icon className="size-4 shrink-0 text-subtle" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {job.name}
                      {!job.enabled && (
                        <span className="rounded border border-line px-1 text-[10px] font-normal text-subtle">
                          {t("backup.jobs.disabled")}
                        </span>
                      )}
                      {job.lastStatus === "ok" && (
                        <CheckCircle2 className="size-3.5 text-ok" aria-hidden />
                      )}
                      {job.lastStatus === "error" && (
                        <XCircle className="size-3.5 text-danger" aria-hidden />
                      )}
                    </div>
                    <span className="text-[11px] text-subtle">
                      {t(SOURCE_LABEL[job.sourceKind])}
                      {job.source && `: ${job.source}`} → {job.repoName} ·{" "}
                      {job.scheduleCron || t("backup.jobs.unscheduled")} ·{" "}
                      {t("backup.jobs.retention", {
                        d: job.keepDaily,
                        w: job.keepWeekly,
                        m: job.keepMonthly,
                      })}
                      {job.quiesce && t("backup.jobs.quiesce", { name: job.quiesce })}
                    </span>
                    <span className="block text-[11px] text-subtle">
                      {t("backup.jobs.lastRun", { when: when(job.lastRunAt) })}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      disabled={busy}
                      title={t("backup.jobs.runNow")}
                      onClick={() => void call("/api/backup/jobs", "POST", { action: "run", id: job.id })}
                      className="flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-xs transition-colors hover:border-brand disabled:opacity-50"
                    >
                      <Play className="size-3.5" /> {t("backup.jobs.run")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSnapshotsFor(job)}
                      className="rounded-md border border-line px-2.5 py-1.5 text-xs transition-colors hover:border-brand"
                    >
                      {t("backup.jobs.snapshots")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setJobDraft(job)}
                      className="rounded-md border border-line px-2.5 py-1.5 text-xs transition-colors hover:border-brand"
                    >
                      {t("common.actions.edit")}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (confirm(t("backup.jobs.confirmDelete", { name: job.name }))) {
                          void call(`/api/backup/jobs?id=${job.id}`, "DELETE");
                        }
                      }}
                      className="rounded border border-line p-1.5 text-subtle transition-colors hover:text-danger disabled:opacity-50"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* --- Geçmiş --- */}
      <section className="rounded-lg border border-line bg-surface">
        <div className="border-b border-line px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <History className="size-4 text-subtle" aria-hidden />
            {t("backup.runs.title")}
          </h2>
        </div>
        {data.runs.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-subtle">{t("backup.runs.empty")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.runs.slice(0, 20).map((run) => (
              <li key={run.id} className="flex flex-wrap items-baseline gap-x-3 px-5 py-2 text-xs">
                <span className="w-36 shrink-0 tabular-nums text-subtle">
                  {f.dateTime(run.startedAt * 1000)}
                </span>
                <span className="w-32 shrink-0 truncate font-medium">{run.jobName}</span>
                <span
                  className={`w-14 shrink-0 ${
                    run.status === "ok"
                      ? "text-ok"
                      : run.status === "error"
                        ? "text-danger"
                        : "text-subtle"
                  }`}
                >
                  {run.status}
                </span>
                <span className="min-w-0 flex-1 text-subtle">{run.detail}</span>
                <span className="shrink-0 tabular-nums text-subtle">
                  {run.bytesAdded > 0 && formatBytes(run.bytesAdded)}
                  {run.durationMs > 0 &&
                    t("backup.runs.seconds", { value: f.number(run.durationMs / 1000, { maximumFractionDigits: 1, minimumFractionDigits: 1 }) })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <RepoModal
        key={`repo-${repoDraft?.id ?? (repoDraft ? "yeni" : "yok")}`}
        draft={repoDraft}
        busy={busy}
        onClose={() => setRepoDraft(null)}
        onSubmit={async (payload, isNew) => {
          if (await call("/api/backup/repos", isNew ? "POST" : "PATCH", payload)) {
            setRepoDraft(null);
          }
        }}
      />

      <JobModal
        key={`job-${jobDraft?.id ?? (jobDraft ? "yeni" : "yok")}`}
        draft={jobDraft}
        repos={data.repos}
        volumes={volumes}
        containers={containers}
        busy={busy}
        onClose={() => setJobDraft(null)}
        onSubmit={async (payload, isNew) => {
          if (await call("/api/backup/jobs", isNew ? "POST" : "PATCH", payload)) {
            setJobDraft(null);
          }
        }}
      />

      {/* `key` işe bağlı: başka bir işin snapshot'ları açılınca bileşen
          yeniden kurulur ve önceki listeden hiçbir şey sızmaz. */}
      <SnapshotsModal
        key={snapshotsFor?.id ?? "yok"}
        job={snapshotsFor}
        onClose={() => setSnapshotsFor(null)}
      />
    </div>
  );
}

function RepoModal({
  draft,
  busy,
  onClose,
  onSubmit,
}: {
  draft: (Partial<BackupRepo> & { password?: string; env?: string }) | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>, isNew: boolean) => void;
}) {
  // Taslak `key` ile bileşene bağlı: yeni bir depo açılınca bileşen yeniden
  // kurulur ve form kendiliğinden doğru değerlerle başlar.
  const t = useT();
  const [form, setForm] = useState(draft);
  const isNew = !form?.id;

  return (
    <Modal
      open={draft !== null}
      title={isNew ? t("backup.repoModal.add") : t("backup.repoModal.edit")}
      onClose={onClose}
    >
      {form && (
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="text-subtle">{t("users.roles.name")}</span>
            <input
              value={form.name ?? ""}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputClass}
            />
          </label>

          <label className="block text-sm">
            <span className="text-subtle">{t("backup.repoModal.kind")}</span>
            <select
              value={form.kind ?? "local"}
              onChange={(e) => setForm({ ...form, kind: e.target.value as BackupRepo["kind"] })}
              className={inputClass}
            >
              <option value="local">{t("backup.repoKind.local")}</option>
              <option value="rclone">{t("backup.repoKind.rclone")}</option>
              <option value="s3">{t("backup.repoKind.s3")}</option>
            </select>
          </label>

          <label className="block text-sm">
            <span className="text-subtle">
              {form.kind === "local" ? t("backup.repoModal.hostPath") : t("backup.repoModal.resticUrl")}
            </span>
            <input
              value={form.location ?? ""}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder={
                form.kind === "local"
                  ? "/mnt/yedek/restic"
                  : form.kind === "s3"
                    ? "s3:s3.amazonaws.com/kova-adi"
                    : "rclone:uzak:yedek"
              }
              className={`${inputClass} font-mono`}
            />
            {form.kind === "local" && (
              <span className="mt-1 block text-xs text-subtle">
                {t("backup.repoModal.sameDiskWarning")}
              </span>
            )}
          </label>

          <label className="block text-sm">
            <span className="text-subtle">
              {t("backup.repoModal.password")} {isNew ? "" : t("backup.repoModal.passwordKeep")}
            </span>
            <input
              type="text"
              autoComplete="off"
              value={form.password ?? ""}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className={`${inputClass} font-mono`}
            />
          </label>

          <p className="rounded-md bg-warn/10 px-3 py-2 text-xs text-warn">
            <Rich
              text={t("backup.repoModal.passwordWarning")}
              values={{ strong: <strong>{t("backup.repoModal.passwordWarningStrong")}</strong> }}
            />
          </p>

          {form.kind !== "local" && (
            <label className="block text-sm">
              <span className="text-subtle">{t("backup.repoModal.env")}</span>
              <textarea
                rows={3}
                value={form.env ?? ""}
                onChange={(e) => setForm({ ...form, env: e.target.value })}
                placeholder={"AWS_ACCESS_KEY_ID=...\nAWS_SECRET_ACCESS_KEY=..."}
                className={`${inputClass} font-mono`}
              />
              <span className="mt-1 block text-xs text-subtle">
                <Rich
                  text={t("backup.repoModal.envHelp")}
                  values={{ example: <code>{t("backup.repoModal.envExample")}</code> }}
                />
              </span>
            </label>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:text-ink"
            >
              {t("common.actions.cancel")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onSubmit({ ...form }, isNew)}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {t("common.actions.save")}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function JobModal({
  draft,
  repos,
  volumes,
  containers,
  busy,
  onClose,
  onSubmit,
}: {
  draft: Partial<BackupJob> | null;
  repos: BackupRepo[];
  volumes: string[];
  containers: string[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>, isNew: boolean) => void;
}) {
  const t = useT();
  const [form, setForm] = useState(draft);
  const isNew = !form?.id;

  return (
    <Modal
      open={draft !== null}
      title={isNew ? t("backup.jobModal.add") : t("backup.jobModal.edit")}
      onClose={onClose}
      wide
    >
      {form && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-subtle">{t("backup.jobModal.name")}</span>
              <input
                value={form.name ?? ""}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="block text-sm">
              <span className="text-subtle">{t("backup.jobModal.repo")}</span>
              <select
                value={form.repoId ?? 0}
                onChange={(e) => setForm({ ...form, repoId: Number(e.target.value) })}
                className={inputClass}
              >
                {repos.map((repo) => (
                  <option key={repo.id} value={repo.id}>
                    {repo.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-subtle">{t("backup.jobModal.sourceKind")}</span>
              <select
                value={form.sourceKind ?? "volume"}
                onChange={(e) =>
                  setForm({
                    ...form,
                    sourceKind: e.target.value as SourceKind,
                    source: e.target.value === "volume" ? (volumes[0] ?? "") : "",
                  })
                }
                className={inputClass}
              >
                <option value="volume">{t("backup.source.volume")}</option>
                <option value="host_dir">{t("backup.source.host_dir")}</option>
                <option value="panel_db">{t("backup.source.panel_db")}</option>
              </select>
            </label>

            {form.sourceKind === "volume" && (
              <label className="block text-sm">
                <span className="text-subtle">Volume</span>
                <select
                  value={form.source ?? ""}
                  onChange={(e) => setForm({ ...form, source: e.target.value })}
                  className={inputClass}
                >
                  {volumes.map((volume) => (
                    <option key={volume} value={volume}>
                      {volume}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {form.sourceKind === "host_dir" && (
              <label className="block text-sm">
                <span className="text-subtle">{t("backup.jobModal.hostPath")}</span>
                <input
                  value={form.source ?? ""}
                  onChange={(e) => setForm({ ...form, source: e.target.value })}
                  placeholder="/home/coraspirin/docker"
                  className={`${inputClass} font-mono`}
                />
              </label>
            )}
          </div>

          {form.sourceKind === "panel_db" && (
            <p className="rounded-md bg-brand/5 px-3 py-2 text-xs text-subtle">
              <Rich
                text={t("backup.jobModal.panelDbNote")}
                values={{
                  vacuum: <code>VACUUM INTO</code>,
                  db: <code>panel.db</code>,
                  strong: <strong>{t("backup.jobModal.panelDbStrong")}</strong>,
                }}
              />
            </p>
          )}

          <div>
            <span className="text-sm text-subtle">{t("backup.jobModal.schedule")}</span>
            <div className="mt-1">
              <CronEditor
                value={form.scheduleCron ?? "0 3 * * *"}
                disabled={busy}
                onCommit={(value) => setForm({ ...form, scheduleCron: String(value) })}
              />
            </div>
          </div>

          <label className="block text-sm">
            <span className="text-subtle">{t("backup.jobModal.quiesce")}</span>
            <select
              value={form.quiesce ?? ""}
              onChange={(e) => setForm({ ...form, quiesce: e.target.value })}
              className={inputClass}
            >
              <option value="">{t("backup.jobModal.noQuiesce")}</option>
              {containers.map((container) => (
                <option key={container} value={container}>
                  {container}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-subtle">
              {t("backup.jobModal.quiesceHelp")}
            </span>
          </label>

          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ["keepDaily", t("backup.jobModal.keepDaily")],
                ["keepWeekly", t("backup.jobModal.keepWeekly")],
                ["keepMonthly", t("backup.jobModal.keepMonthly")],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="block text-sm">
                <span className="text-subtle">{label}</span>
                <input
                  type="number"
                  min={0}
                  max={365}
                  value={form[key] ?? 0}
                  onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
                  className={inputClass}
                />
              </label>
            ))}
          </div>

          <label className="block text-sm">
            <span className="text-subtle">{t("backup.jobModal.excludes")}</span>
            <textarea
              rows={2}
              value={form.excludes ?? ""}
              onChange={(e) => setForm({ ...form, excludes: e.target.value })}
              placeholder={"*.tmp\n/data/cache"}
              className={`${inputClass} font-mono`}
            />
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.enabled !== false}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              className="size-4 accent-[var(--brand)]"
            />
            {t("backup.jobModal.enabled")}
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:text-ink"
            >
              {t("common.actions.cancel")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onSubmit({ ...form }, isNew)}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {t("common.actions.save")}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function SnapshotsModal({ job, onClose }: { job: BackupJob | null; onClose: () => void }) {
  const t = useT();
  const f = useFormat();
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);
  const [target, setTarget] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const jobId = job?.id ?? null;

  /*
    Snapshot listesi depodan okunuyor ve bu restic çalıştırmak demek — saniyeler
    sürebilir. Sayfa açılışında değil, yalnızca modal açıldığında yapılıyor.

    `ignore` bayrağı: kullanıcı modalı kapatıp başka bir işi açarsa önceki
    isteğin geç gelen cevabı yanlış listeyi göstermemeli.

    Durum sıfırlaması burada YAPILMIYOR — bileşen çağrıldığı yerde `key` ile
    işe bağlı, iş değişince yeniden kuruluyor ve state kendiliğinden temiz
    geliyor. Efekt içinde senkron setState çağırmak gereksiz render zinciri
    üretirdi.
  */
  useEffect(() => {
    if (jobId === null) return;

    let ignore = false;

    void (async () => {
      try {
        const response = await fetch(`/api/backup/snapshots?jobId=${jobId}`);
        const data = (await response.json()) as { snapshots?: Snapshot[]; error?: string };
        if (ignore) return;
        setSnapshots(data.snapshots ?? []);
        if (data.error) setMessage(data.error);
      } catch {
        if (!ignore) {
          setSnapshots([]);
          setMessage(t("backup.snapshots.readFailed"));
        }
      }
    })();

    return () => {
      ignore = true;
    };
  }, [jobId, t]);

  async function restore() {
    if (!job || !selected) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/backup/snapshots", {
        method: "POST",
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: JSON.stringify({ jobId: job.id, snapshotId: selected, target }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string; message?: string };
      setMessage(data.error ?? data.message ?? t("backup.snapshots.done"));
    } catch {
      setMessage(t("common.errors.network"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={job !== null}
      title={t("backup.snapshots.title", { name: job?.name ?? "" })}
      onClose={onClose}
      wide
    >
      {snapshots === null ? (
        <p className="py-6 text-center text-sm text-subtle">{t("backup.snapshots.reading")}</p>
      ) : snapshots.length === 0 ? (
        <p className="py-6 text-center text-sm text-subtle">
          {t("backup.snapshots.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line">
          {snapshots.map((snapshot) => (
            <li key={snapshot.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-line/30">
                <input
                  type="radio"
                  name="snapshot"
                  checked={selected === snapshot.id}
                  onChange={() => setSelected(snapshot.id)}
                  className="size-4 accent-[var(--brand)]"
                />
                <span className="font-mono text-xs">{snapshot.shortId}</span>
                <span className="flex-1">
                  {f.dateTime(snapshot.time * 1000)}
                </span>
                <span className="text-xs text-subtle">
                  {snapshot.sizeBytes !== null && formatBytes(snapshot.sizeBytes)}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {snapshots !== null && snapshots.length > 0 && (
        <div className="mt-4 space-y-2 rounded-md border border-warn/40 bg-warn/5 p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-warn">
            <RotateCcw className="size-4" aria-hidden /> {t("backup.snapshots.restore")}
          </p>
          <p className="text-xs text-subtle">
            <Rich
              text={t("backup.snapshots.restoreNote")}
              values={{ empty: <strong>{t("backup.snapshots.emptyWord")}</strong> }}
            />
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="/home/coraspirin/geri-yukleme"
              className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-3 py-1.5 font-mono text-sm outline-none focus:border-brand sm:min-w-56"
            />
            <button
              type="button"
              disabled={busy || !selected || !target}
              onClick={() => void restore()}
              className="rounded-md bg-warn px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? t("backup.snapshots.extracting") : t("backup.snapshots.restoreButton")}
            </button>
          </div>
        </div>
      )}

      {message && <p className="mt-3 whitespace-pre-wrap text-sm">{message}</p>}
    </Modal>
  );
}
