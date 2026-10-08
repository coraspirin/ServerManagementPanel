"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Boxes, CalendarClock, Database, FolderPlus, ListChecks, Play, Save, Server, Settings2, Trash2 } from "lucide-react";

import { CronEditor } from "@/components/settings/CronEditor";
import { DirBrowser } from "@/components/settings/DirPicker";
import type { SystemStatus } from "@/lib/backup/overview";
import {
  DEFAULT_JOB_OPTIONS,
  type BackupJob,
  type BackupRepo,
  type DbItem,
  type DockerItem,
  type JobOptions,
  type LiveProgress,
  type OsItem,
  type SystemCategory,
} from "@/lib/backup/types";
import { useT } from "@/lib/i18n/client";
import { api, buttonClass, cardClass, inputClass, primaryButtonClass, smallButtonClass } from "./client";
import { HistoryTab } from "./HistoryTab";
import { LiveProgressCard, Notice, SectionHeader, StateBadge, Toggle } from "./parts";
import { SnapshotBrowser } from "./SnapshotBrowser";

type Payload = {
  job: BackupJob | null;
  items: (DockerItem | OsItem | DbItem)[];
  discoveryError: string | null;
  upcoming: number[];
};

type Settings = {
  repoId: number;
  scheduleCron: string;
  keepLast: number;
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
  notifySuccess: boolean;
  enabled: boolean;
  options: JobOptions;
};

/** Hazır zamanlamalar — çoğu kullanıcı cron görmeden seçer. */
const PRESETS: { cron: string; label: "nightly" | "sixHours" | "weekly" | "manual" }[] = [
  { cron: "0 2 * * *", label: "nightly" },
  { cron: "0 */6 * * *", label: "sixHours" },
  { cron: "0 3 * * 0", label: "weekly" },
  { cron: "", label: "manual" },
];

const ICONS: Record<SystemCategory, typeof Boxes> = { docker: Boxes, os: Server, database: Database };

function settingsOf(job: BackupJob | null, locations: BackupRepo[]): Settings {
  if (!job) {
    return {
      repoId: locations[0]?.id ?? 0,
      scheduleCron: "0 2 * * *",
      keepLast: 7,
      keepDaily: 0,
      keepWeekly: 0,
      keepMonthly: 0,
      notifySuccess: false,
      enabled: true,
      options: { ...DEFAULT_JOB_OPTIONS },
    };
  }
  return {
    repoId: job.repoId,
    scheduleCron: job.scheduleCron,
    keepLast: job.keepLast,
    keepDaily: job.keepDaily,
    keepWeekly: job.keepWeekly,
    keepMonthly: job.keepMonthly,
    notifySuccess: job.notifySuccess,
    enabled: job.enabled,
    options: { ...job.options },
  };
}

export function SystemTab({
  category,
  status,
  locations,
  live,
  revision,
  onSetup,
  onChanged,
}: {
  category: SystemCategory;
  status: SystemStatus | null;
  locations: BackupRepo[];
  live: LiveProgress[];
  revision: number;
  onSetup: () => void;
  onChanged: () => void;
}) {
  const t = useT();
  const [data, setData] = useState<Payload | null>(null);
  const [settings, setSettings] = useState<Settings>(() => settingsOf(null, locations));
  const [items, setItems] = useState<(DockerItem | OsItem | DbItem)[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<Payload>(`/api/backup/systems/${category}`)
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        // Kullanıcı düzenleme yaparken arka plan tazelemesi formu ezmesin.
        if (!dirty) {
          setSettings(settingsOf(payload.job, locations));
          setItems(payload.items);
          setAdvanced((payload.job?.keepDaily ?? 0) + (payload.job?.keepWeekly ?? 0) + (payload.job?.keepMonthly ?? 0) > 0);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      cancelled = true;
    };
    // `dirty` ve `locations` bilinçli olarak dışarıda: yalnızca sekme/koşu değişince yükle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, revision]);

  const job = data?.job ?? null;
  const running = live.filter((run) => job && run.jobId === job.id);
  const Icon = ICONS[category];

  const update = (patch: Partial<Settings>) => {
    setSettings((current) => ({ ...current, ...patch }));
    setDirty(true);
  };
  const updateOptions = (patch: Partial<JobOptions>) => {
    setSettings((current) => ({ ...current, options: { ...current.options, ...patch } }));
    setDirty(true);
  };

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const payload = await api<{ job: BackupJob }>(`/api/backup/systems/${category}`, "PUT", {
        settings: advanced ? settings : { ...settings, keepDaily: 0, keepWeekly: 0, keepMonthly: 0 },
        items: itemsForSave(category, items),
      });
      setData((current) => (current ? { ...current, job: payload.job } : current));
      setDirty(false);
      setMessage({ tone: "ok", text: t("backup.system.saved") });
      onChanged();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const runNow = async () => {
    if (!job) return;
    setMessage(null);
    try {
      await api(`/api/backup/jobs/${job.id}/run`, "POST");
      onChanged();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  };

  if (locations.length === 0) {
    return (
      <section className={`${cardClass} p-6 text-center`}>
        <p className="text-sm text-subtle">{t("backup.system.needLocation")}</p>
        <button type="button" onClick={onSetup} className={`${primaryButtonClass} mt-4`}>
          {t("backup.setup.start")}
        </button>
      </section>
    );
  }

  const preset = PRESETS.find((entry) => entry.cron === settings.scheduleCron);
  const retentionMax = settings.keepLast + (advanced ? settings.keepDaily + settings.keepWeekly + settings.keepMonthly : 0);

  return (
    <div className="space-y-5">
      <section className={`${cardClass} flex flex-wrap items-center gap-3 p-4`}>
        <Icon className="size-6 text-subtle" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{t(`backup.category.${category}`)}</h2>
          <p className="text-xs text-subtle">{t(`backup.system.intro.${category}`)}</p>
        </div>
        {status && <StateBadge state={running.some((run) => !run.done) ? "running" : status.state} />}
        {job && (
          <button
            type="button"
            disabled={running.some((run) => !run.done) || dirty}
            title={dirty ? t("backup.system.saveFirst") : undefined}
            onClick={() => void runNow()}
            className={primaryButtonClass}
          >
            <Play className="size-4" aria-hidden /> {t("backup.actions.runNow")}
          </button>
        )}
      </section>

      {running.map((run) => (
        <LiveProgressCard key={run.runId} run={run} title={t(`backup.category.${category}`)} />
      ))}

      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {!job && <Notice tone="info">{t("backup.system.notConfigured")}</Notice>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        {/* --- Ayarlar --- */}
        <section className={cardClass}>
          <SectionHeader icon={Settings2} title={t("backup.system.settings")} />
          <div className="space-y-4 px-5 py-4">
            <Toggle
              checked={settings.enabled}
              onChange={(value) => update({ enabled: value })}
              label={t("backup.system.enabled")}
              hint={t("backup.system.enabledHint")}
            />

            <label className="block text-sm">
              <span className="mb-1 block text-subtle">{t("backup.system.location")}</span>
              <select
                className={inputClass}
                value={settings.repoId}
                onChange={(event) => update({ repoId: Number(event.target.value) })}
              >
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name} — {location.location}
                  </option>
                ))}
              </select>
            </label>

            <div className="text-sm">
              <span className="mb-1 flex items-center gap-1.5 text-subtle">
                <CalendarClock className="size-3.5" aria-hidden /> {t("backup.system.schedule")}
              </span>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((entry) => (
                  <button
                    key={entry.label}
                    type="button"
                    onClick={() => update({ scheduleCron: entry.cron })}
                    className={`${smallButtonClass} ${preset?.cron === entry.cron ? "border-brand bg-brand/10 text-brand" : ""}`}
                  >
                    {t(`backup.schedule.${entry.label}`)}
                  </button>
                ))}
              </div>
              <div className="mt-3">
                <CronEditor
                  value={settings.scheduleCron || "0 2 * * *"}
                  disabled={settings.scheduleCron === ""}
                  allowCustom
                  onCommit={(expression) => update({ scheduleCron: expression })}
                />
              </div>
            </div>

            <label className="block text-sm">
              <span className="mb-1 block text-subtle">{t("backup.system.keepLast")}</span>
              <input
                type="number"
                min={advanced ? 0 : 1}
                max={1000}
                className={`${inputClass} max-w-32`}
                value={settings.keepLast}
                onChange={(event) => update({ keepLast: Number(event.target.value) })}
              />
              <span className="mt-1 block text-xs text-subtle">{t("backup.system.keepLastHint")}</span>
            </label>

            <details open={advanced} className="rounded-md border border-line px-3 py-2">
              <summary
                className="cursor-pointer text-sm text-subtle"
                onClick={(event) => {
                  event.preventDefault();
                  setAdvanced((value) => !value);
                  setDirty(true);
                }}
              >
                {t("backup.system.gfs")}
              </summary>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {(["keepDaily", "keepWeekly", "keepMonthly"] as const).map((key) => (
                  <label key={key} className="text-xs">
                    <span className="mb-1 block text-subtle">{t(`backup.system.${key}`)}</span>
                    <input
                      type="number"
                      min={0}
                      max={1000}
                      className={inputClass}
                      value={settings[key]}
                      onChange={(event) => update({ [key]: Number(event.target.value) })}
                    />
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-subtle">{t("backup.system.gfsHint")}</p>
            </details>
            <p className="text-xs text-subtle">{t("backup.system.retentionPreview", { count: retentionMax })}</p>

            <div className="divide-y divide-line border-t border-line pt-2">
              <Toggle
                checked={settings.notifySuccess}
                onChange={(value) => update({ notifySuccess: value })}
                label={t("backup.system.notifySuccess")}
                hint={t("backup.system.notifySuccessHint")}
              />
              {category === "docker" && (
                <Toggle
                  checked={settings.options.autoInclude}
                  onChange={(value) => updateOptions({ autoInclude: value })}
                  label={t("backup.system.autoInclude")}
                  hint={t("backup.system.autoIncludeHint")}
                />
              )}
              {category === "database" && (
                <Toggle
                  checked={settings.options.autoInclude}
                  onChange={(value) => updateOptions({ autoInclude: value })}
                  label={t("backup.system.autoIncludeDb")}
                  hint={t("backup.system.autoIncludeDbHint")}
                />
              )}
              <Toggle
                checked={settings.options.retry}
                onChange={(value) => updateOptions({ retry: value })}
                label={t("backup.system.retry")}
                hint={t("backup.system.retryHint")}
              />
              <Toggle
                checked={settings.options.spaceCheck}
                onChange={(value) => updateOptions({ spaceCheck: value })}
                label={t("backup.system.spaceCheck")}
                hint={t("backup.system.spaceCheckHint")}
              />
              <Toggle
                checked={settings.options.anomaly}
                onChange={(value) => updateOptions({ anomaly: value })}
                label={t("backup.system.anomaly")}
                hint={t("backup.system.anomalyHint")}
              />
              <Toggle
                checked={settings.options.lowPriority}
                onChange={(value) => updateOptions({ lowPriority: value })}
                label={t("backup.system.lowPriority")}
                hint={t("backup.system.lowPriorityHint")}
              />
            </div>

            <label className="block text-sm">
              <span className="mb-1 block text-subtle">{t("backup.system.excludes")}</span>
              <textarea
                rows={3}
                className={`${inputClass} font-mono text-xs`}
                placeholder={t("backup.system.excludesPlaceholder")}
                value={settings.options.excludes.join("\n")}
                onChange={(event) => updateOptions({ excludes: event.target.value.split("\n") })}
              />
            </label>
          </div>
        </section>

        {/* --- Kapsam --- */}
        <section className={cardClass}>
          <SectionHeader
            icon={ListChecks}
            title={t("backup.system.scope")}
            aside={
              <span className="text-xs text-subtle">
                {t("backup.system.selectedCount", {
                  count: items.filter((item) => item.selected).length,
                  total: items.length,
                })}
              </span>
            }
          />
          {data === null ? (
            <p className="px-5 py-8 text-center text-sm text-subtle">{t("backup.common.loading")}</p>
          ) : (
            <>
              {data.discoveryError && (
                <div className="px-5 pt-4">
                  <Notice tone="error">{data.discoveryError}</Notice>
                </div>
              )}
              <ScopeList
                category={category}
                items={items}
                autoInclude={settings.options.autoInclude}
                onChange={(next) => {
                  setItems(next);
                  setDirty(true);
                }}
              />
            </>
          )}
        </section>
      </div>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-3 bg-canvas/90 px-1 py-3 backdrop-blur">
        {dirty && <span className="text-xs text-warn">{t("backup.system.unsaved")}</span>}
        {dirty && (
          <button
            type="button"
            className={buttonClass}
            onClick={() => {
              setSettings(settingsOf(job, locations));
              setItems(data?.items ?? []);
              setDirty(false);
            }}
          >
            {t("backup.common.undo")}
          </button>
        )}
        <button type="button" disabled={busy || (!dirty && job !== null)} onClick={() => void save()} className={primaryButtonClass}>
          <Save className="size-4" aria-hidden /> {job ? t("backup.common.save") : t("backup.system.create")}
        </button>
      </div>

      {job && (
        <SnapshotBrowser
          job={job}
          category={category}
          items={items}
          revision={revision}
          onStarted={onChanged}
        />
      )}
      {job && <HistoryTab revision={revision} jobId={job.id} compact />}
    </div>
  );
}

function itemsForSave(category: SystemCategory, items: (DockerItem | OsItem | DbItem)[]) {
  if (category === "docker") {
    return (items as DockerItem[]).map((item) => ({ name: item.name, selected: item.selected, stop: item.stop }));
  }
  if (category === "os") return (items as OsItem[]).map((item) => ({ path: item.path, selected: item.selected }));
  return (items as DbItem[]).map((item) => ({ ref: item.ref, kind: item.kind, selected: item.selected }));
}

function ScopeList({
  category,
  items,
  autoInclude,
  onChange,
}: {
  category: SystemCategory;
  items: (DockerItem | OsItem | DbItem)[];
  autoInclude: boolean;
  onChange: (items: (DockerItem | OsItem | DbItem)[]) => void;
}) {
  const t = useT();
  const [browsing, setBrowsing] = useState(false);

  const setAll = (selected: boolean) =>
    onChange(items.map((item) => ({ ...item, selected: selected && !("isSelf" in item && item.isSelf) })));
  const patch = (index: number, value: Partial<DockerItem & OsItem & DbItem>) =>
    onChange(items.map((item, current) => (current === index ? { ...item, ...value } : item)));

  const unprotected = useMemo(
    () => (category === "docker" ? (items as DockerItem[]).filter((item) => !item.selected && !item.isSelf).length : 0),
    [category, items],
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-2">
        <button type="button" className={smallButtonClass} onClick={() => setAll(true)}>
          {t("backup.scope.selectAll")}
        </button>
        <button type="button" className={smallButtonClass} onClick={() => setAll(false)}>
          {t("backup.scope.selectNone")}
        </button>
        {category === "os" && (
          <button type="button" className={`${smallButtonClass} ml-auto`} onClick={() => setBrowsing(true)}>
            <FolderPlus className="size-3.5" aria-hidden /> {t("backup.scope.addFolder")}
          </button>
        )}
      </div>

      {category === "docker" && unprotected > 0 && !autoInclude && (
        <div className="px-5 pt-3">
          <Notice tone="warn">{t("backup.scope.unprotected", { count: unprotected })}</Notice>
        </div>
      )}

      {items.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-subtle">{t(`backup.scope.empty.${category}`)}</p>
      ) : (
        <ul className="max-h-[32rem] divide-y divide-line overflow-y-auto thin-scrollbar">
          {items.map((item, index) => (
            <li key={"name" in item ? item.name : "path" in item ? item.path : `${item.kind}:${item.ref}`} className="flex items-start gap-3 px-5 py-2.5">
              <input
                type="checkbox"
                className="mt-1 size-4 shrink-0 accent-[var(--brand)]"
                checked={item.selected}
                disabled={"credentials" in item && item.credentials === "missing"}
                onChange={(event) => patch(index, { selected: event.target.checked })}
                aria-label={"name" in item ? item.name : "path" in item ? item.path : item.ref || t("backup.scope.panelDb")}
              />
              <div className="min-w-0 flex-1 text-sm">
                {category === "docker" && <DockerRow item={item as DockerItem} onStop={(stop) => patch(index, { stop })} />}
                {category === "os" && <OsRow item={item as OsItem} onRemove={() => onChange(items.filter((_, i) => i !== index))} />}
                {category === "database" && <DbRow item={item as DbItem} />}
              </div>
            </li>
          ))}
        </ul>
      )}

      <DirBrowser
        open={browsing}
        title={t("backup.scope.addFolder")}
        startPath="/"
        onClose={() => setBrowsing(false)}
        onPick={(path) => {
          setBrowsing(false);
          if (!(items as OsItem[]).some((item) => item.path === path)) {
            onChange([...items, { path, recommended: false, selected: true }]);
          }
        }}
      />
    </div>
  );
}

function DockerRow({ item, onStop }: { item: DockerItem; onStop: (stop: boolean) => void }) {
  const t = useT();
  const volumes = item.mounts.filter((mount) => !mount.skipped);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{item.name}</span>
        <span className={`text-[11px] ${item.state === "running" ? "text-ok" : "text-subtle"}`}>{item.state}</span>
        {item.composeProject && (
          <span className="rounded border border-line px-1 text-[10px] text-subtle">{item.composeProject}</span>
        )}
        {item.isSelf && <span className="rounded border border-line px-1 text-[10px] text-subtle">{t("backup.scope.self")}</span>}
        {item.isDatabase && (
          <span className="rounded border border-line px-1 text-[10px] text-subtle">{t("backup.scope.isDatabase")}</span>
        )}
      </div>
      <div className="truncate text-xs text-subtle" title={item.image}>
        {item.image}
      </div>
      <div className="mt-0.5 text-xs text-subtle">
        {volumes.length === 0
          ? t("backup.scope.noData")
          : volumes.map((mount) => `${mount.type === "volume" ? mount.source : mount.source} → ${mount.destination}`).join(" · ")}
      </div>
      {item.selected && (
        <label className="mt-1 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            className="size-3.5 accent-[var(--brand)]"
            checked={item.stop}
            onChange={(event) => onStop(event.target.checked)}
          />
          {t("backup.scope.stop")}
          {item.suggestStop && !item.stop && <span className="text-warn">{t("backup.scope.stopSuggested")}</span>}
        </label>
      )}
    </>
  );
}

function OsRow({ item, onRemove }: { item: OsItem; onRemove: () => void }) {
  const t = useT();
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate font-mono text-sm">{item.path}</code>
      {item.recommended ? (
        <span className="rounded border border-line px-1 text-[10px] text-subtle">{t("backup.scope.recommended")}</span>
      ) : (
        <button type="button" onClick={onRemove} className="text-subtle hover:text-danger" aria-label={t("backup.common.remove")}>
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function DbRow({ item }: { item: DbItem }) {
  const t = useT();
  if (item.kind === "panel_db") {
    return (
      <>
        <div className="font-medium">{t("backup.scope.panelDb")}</div>
        <div className="text-xs text-subtle">{t("backup.scope.panelDbHint")}</div>
      </>
    );
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{item.ref}</span>
        <span className="rounded border border-line px-1 text-[10px] text-subtle">{item.engine}</span>
        <span className={`text-[11px] ${item.state === "running" ? "text-ok" : "text-subtle"}`}>{item.state}</span>
      </div>
      <div className="truncate text-xs text-subtle">{item.image}</div>
      <div className={`text-xs ${item.credentials === "missing" ? "text-danger" : "text-subtle"}`}>
        {t(`backup.scope.credentials.${item.credentials}`)}
        {item.credentials === "missing" && (
          <Link href="/database" className="ml-1 underline">
            {t("backup.scope.addConnection")}
          </Link>
        )}
      </div>
    </>
  );
}
