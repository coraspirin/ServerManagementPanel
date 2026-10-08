"use client";

import { useState } from "react";
import { FolderCog, History, Pencil, Play, Plus, Power, Trash2 } from "lucide-react";

import { Modal } from "@/components/Modal";
import { CronEditor } from "@/components/settings/CronEditor";
import { DirBrowser } from "@/components/settings/DirPicker";
import type { SystemStatus } from "@/lib/backup/overview";
import type { BackupJob, BackupRepo, LiveProgress } from "@/lib/backup/types";
import { useFormat, useT } from "@/lib/i18n/client";
import { api, buttonClass, cardClass, inputClass, primaryButtonClass, smallButtonClass } from "./client";
import { LiveProgressCard, Notice, SectionHeader, StateBadge, Toggle } from "./parts";
import { SnapshotBrowser } from "./SnapshotBrowser";

/**
 * Özel işler — tek bir klasör ya da volume için elle tanımlanan işler
 * (yedekleme v1'den taşınanlar da burada). Üç sistemin kapsamadığı bir yer
 * için "Gelişmiş" seçenek.
 */

type Draft = {
  id?: number;
  name: string;
  repoId: number;
  sourceKind: "host_dir" | "volume";
  source: string;
  scheduleCron: string;
  quiesce: string;
  excludes: string;
  keepLast: number;
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
  notifySuccess: boolean;
  enabled: boolean;
};

function draftOf(job: BackupJob | null, locations: BackupRepo[]): Draft {
  if (!job) {
    return {
      name: "",
      repoId: locations[0]?.id ?? 0,
      sourceKind: "host_dir",
      source: "",
      scheduleCron: "0 3 * * *",
      quiesce: "",
      excludes: "",
      keepLast: 7,
      keepDaily: 0,
      keepWeekly: 0,
      keepMonthly: 0,
      notifySuccess: false,
      enabled: true,
    };
  }
  const source = job.sources[0];
  return {
    id: job.id,
    name: job.name,
    repoId: job.repoId,
    sourceKind: source?.kind === "volume" ? "volume" : "host_dir",
    source: source?.ref ?? "",
    scheduleCron: job.scheduleCron,
    quiesce: job.quiesce,
    excludes: job.options.excludes.join("\n"),
    keepLast: job.keepLast,
    keepDaily: job.keepDaily,
    keepWeekly: job.keepWeekly,
    keepMonthly: job.keepMonthly,
    notifySuccess: job.notifySuccess,
    enabled: job.enabled,
  };
}

export function CustomJobs({
  statuses,
  jobs,
  locations,
  live,
  onChanged,
}: {
  statuses: SystemStatus[];
  jobs: BackupJob[];
  locations: BackupRepo[];
  live: LiveProgress[];
  onChanged: () => void;
}) {
  const t = useT();
  const f = useFormat();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [browsing, setBrowsing] = useState<BackupJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const call = async (url: string, method: string, body?: unknown) => {
    setError(null);
    try {
      await api(url, method, body);
      onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  if (jobs.length === 0 && locations.length === 0) return null;

  return (
    <section className={cardClass}>
      <SectionHeader
        icon={FolderCog}
        title={t("backup.custom.title")}
        aside={
          <button
            type="button"
            disabled={locations.length === 0}
            className={smallButtonClass}
            onClick={() => setEditing(draftOf(null, locations))}
          >
            <Plus className="size-3.5" aria-hidden /> {t("backup.custom.add")}
          </button>
        }
      />
      {error && (
        <div className="px-5 pt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {jobs.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-subtle">{t("backup.custom.empty")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {jobs.map((job) => {
            const status = statuses.find((entry) => entry.jobId === job.id);
            const run = live.find((entry) => entry.jobId === job.id && !entry.done);
            const source = job.sources[0];
            return (
              <li key={job.id} className="space-y-2 px-5 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {job.name}
                      {status && <StateBadge state={run ? "running" : status.state} />}
                    </div>
                    <p className="truncate text-xs text-subtle">
                      {source ? `${t(`backup.source.${source.kind}`)}: ${source.ref || "—"}` : "—"} → {job.repoName}
                      {" · "}
                      {status?.lastSuccessAt
                        ? t("backup.custom.lastSuccess", { when: f.relative(status.lastSuccessAt * 1000) })
                        : t("backup.card.none")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      disabled={Boolean(run)}
                      className={smallButtonClass}
                      onClick={() => void call(`/api/backup/jobs/${job.id}/run`, "POST")}
                    >
                      <Play className="size-3.5" aria-hidden /> {t("backup.actions.runNow")}
                    </button>
                    <button type="button" className={smallButtonClass} onClick={() => setBrowsing(job)}>
                      <History className="size-3.5" aria-hidden /> {t("backup.snapshots.title")}
                    </button>
                    <button type="button" className={smallButtonClass} onClick={() => setEditing(draftOf(job, locations))}>
                      <Pencil className="size-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      className={smallButtonClass}
                      title={job.enabled ? t("backup.custom.disable") : t("backup.custom.enable")}
                      onClick={() => void call(`/api/backup/jobs/${job.id}`, "PATCH", { enabled: !job.enabled })}
                    >
                      <Power className={`size-3.5 ${job.enabled ? "text-ok" : "text-subtle"}`} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className={`${smallButtonClass} hover:border-danger hover:text-danger`}
                      onClick={() => {
                        if (confirm(t("backup.custom.confirmDelete", { name: job.name }))) {
                          void call(`/api/backup/jobs/${job.id}`, "DELETE");
                        }
                      }}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  </div>
                </div>
                {run && <LiveProgressCard run={run} title={job.name} />}
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <CustomJobModal
          draft={editing}
          locations={locations}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
      {browsing && (
        <Modal open wide title={t("backup.custom.snapshotsOf", { name: browsing.name })} onClose={() => setBrowsing(null)}>
          <div className="p-3">
            <SnapshotBrowser
              job={browsing}
              category="custom"
              items={[]}
              revision={0}
              onStarted={onChanged}
            />
          </div>
        </Modal>
      )}
    </section>
  );
}

function CustomJobModal({
  draft: initial,
  locations,
  onClose,
  onSaved,
}: {
  draft: Draft;
  locations: BackupRepo[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState(initial);
  const [browsing, setBrowsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (draft.id) await api(`/api/backup/jobs/${draft.id}`, "PUT", draft);
      else await api("/api/backup/jobs", "POST", draft);
      onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setBusy(false);
    }
  };

  return (
    <Modal open wide title={draft.id ? t("backup.custom.edit") : t("backup.custom.add")} onClose={onClose}>
      <div className="space-y-4 p-5 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-subtle">{t("backup.custom.name")}</span>
            <input className={inputClass} value={draft.name} onChange={(event) => set({ name: event.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-subtle">{t("backup.system.location")}</span>
            <select className={inputClass} value={draft.repoId} onChange={(event) => set({ repoId: Number(event.target.value) })}>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-subtle">{t("backup.custom.sourceKind")}</span>
            <select
              className={inputClass}
              value={draft.sourceKind}
              onChange={(event) => set({ sourceKind: event.target.value as Draft["sourceKind"] })}
            >
              <option value="host_dir">{t("backup.source.host_dir")}</option>
              <option value="volume">{t("backup.source.volume")}</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-subtle">{t("backup.custom.source")}</span>
            <div className="flex gap-2">
              <input className={`${inputClass} font-mono`} value={draft.source} onChange={(event) => set({ source: event.target.value })} />
              {draft.sourceKind === "host_dir" && (
                <button type="button" className={smallButtonClass} onClick={() => setBrowsing(true)}>
                  {t("backup.common.browse")}
                </button>
              )}
            </div>
          </label>
        </div>

        <div>
          <span className="mb-1 block text-subtle">{t("backup.system.schedule")}</span>
          <CronEditor value={draft.scheduleCron || "0 3 * * *"} disabled={false} onCommit={(value) => set({ scheduleCron: value })} />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(["keepLast", "keepDaily", "keepWeekly", "keepMonthly"] as const).map((key) => (
            <label key={key} className="block text-xs">
              <span className="mb-1 block text-subtle">{t(`backup.system.${key}`)}</span>
              <input
                type="number"
                min={0}
                className={inputClass}
                value={draft[key]}
                onChange={(event) => set({ [key]: Number(event.target.value) })}
              />
            </label>
          ))}
        </div>

        <label className="block">
          <span className="mb-1 block text-subtle">{t("backup.custom.quiesce")}</span>
          <textarea
            rows={2}
            className={`${inputClass} font-mono text-xs`}
            value={draft.quiesce}
            onChange={(event) => set({ quiesce: event.target.value })}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-subtle">{t("backup.system.excludes")}</span>
          <textarea
            rows={2}
            className={`${inputClass} font-mono text-xs`}
            value={draft.excludes}
            onChange={(event) => set({ excludes: event.target.value })}
          />
        </label>
        <Toggle
          checked={draft.notifySuccess}
          onChange={(value) => set({ notifySuccess: value })}
          label={t("backup.system.notifySuccess")}
        />

        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonClass} onClick={onClose}>
            {t("backup.common.cancel")}
          </button>
          <button type="button" disabled={busy} className={primaryButtonClass} onClick={() => void save()}>
            {t("backup.common.save")}
          </button>
        </div>
      </div>
      <DirBrowser
        open={browsing}
        title={t("backup.custom.source")}
        startPath={draft.source || "/"}
        onClose={() => setBrowsing(false)}
        onPick={(path) => {
          set({ source: path });
          setBrowsing(false);
        }}
      />
    </Modal>
  );
}
