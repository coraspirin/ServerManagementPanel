"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight,
  ChevronRight,
  Download,
  File,
  Folder,
  FolderOutput,
  History,
  Link2,
  RotateCcw,
  Trash2,
} from "lucide-react";

import { Modal } from "@/components/Modal";
import { DirBrowser } from "@/components/settings/DirPicker";
import type {
  BackupJob,
  DbItem,
  DockerItem,
  OsItem,
  Snapshot,
  SnapshotDiff,
  SnapshotEntry,
  SystemCategory,
} from "@/lib/backup/types";
import { withHostQuery } from "@/lib/client/host";
import { useFormat, useT } from "@/lib/i18n/client";
import { api, buttonClass, cardClass, formatBytes, inputClass, primaryButtonClass, smallButtonClass } from "./client";
import { Notice, SectionHeader } from "./parts";

type RestoreMode = "folder" | "original" | "container" | "database";

/** Snapshot içindeki ham yolu kullanıcıya anlaşılır gösterir. */
function friendlyPath(path: string): string {
  return path
    .replace(/^\/host(?=\/|$)/, "")
    .replace(/^\/src\/docker\/_compose\//, "compose: ")
    .replace(/^\/src\/docker\//, "docker: ")
    .replace(/^\/stage\/job-\d+\/db\//, "dump: ")
    .replace(/^\/stage\/job-\d+\/docker\//, "config: ") || "/";
}

export function SnapshotBrowser({
  job,
  category,
  items,
  revision,
  onStarted,
}: {
  job: Pick<BackupJob, "id">;
  category: SystemCategory | "custom";
  items: (DockerItem | OsItem | DbItem)[];
  revision: number;
  onStarted: () => void;
}) {
  const t = useT();
  const f = useFormat();
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);
  const [downloadSupported, setDownloadSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Snapshot | null>(null);
  const [path, setPath] = useState("/");
  const [entries, setEntries] = useState<SnapshotEntry[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [restore, setRestore] = useState<RestoreMode | null>(null);
  const [compareWith, setCompareWith] = useState<string>("");
  const [diff, setDiff] = useState<SnapshotDiff | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ snapshots: Snapshot[]; downloadSupported: boolean }>(`/api/backup/snapshots?jobId=${job.id}`)
      .then((payload) => {
        if (cancelled) return;
        setSnapshots(payload.snapshots);
        setDownloadSupported(payload.downloadSupported);
        setError(null);
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        setSnapshots([]);
        setError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [job.id, revision]);

  const go = (next: string) => {
    setEntries(null);
    setPath(next);
  };

  const open = (snapshot: Snapshot) => {
    setSelected(snapshot);
    setPicked(new Set());
    setDiff(null);
    setCompareWith("");
    go(snapshot.paths.length === 1 ? snapshot.paths[0] : "/");
  };

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    api<{ entries: SnapshotEntry[] }>(
      `/api/backup/snapshots/browse?jobId=${job.id}&snapshotId=${selected.id}&path=${encodeURIComponent(path)}`,
    )
      .then((payload) => !cancelled && setEntries(payload.entries))
      .catch((failure: unknown) => {
        if (!cancelled) {
          setEntries([]);
          setError(failure instanceof Error ? failure.message : String(failure));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [job.id, selected, path]);

  const grouped = useMemo(() => {
    const groups = new Map<string, Snapshot[]>();
    for (const snapshot of snapshots ?? []) {
      const key = f.date(snapshot.time * 1000);
      groups.set(key, [...(groups.get(key) ?? []), snapshot]);
    }
    return [...groups.entries()];
  }, [snapshots, f]);

  const togglePick = (entryPath: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(entryPath)) next.delete(entryPath);
      else next.add(entryPath);
      return next;
    });

  const crumbs = path === "/" ? [] : path.split("/").filter(Boolean);

  const deleteSnapshot = async (snapshot: Snapshot) => {
    if (!confirm(t("backup.snapshots.confirmDelete", { id: snapshot.shortId, when: f.dateTime(snapshot.time * 1000) }))) return;
    try {
      await api(`/api/backup/snapshots?jobId=${job.id}&snapshotId=${snapshot.id}`, "DELETE");
      setSnapshots((current) => (current ?? []).filter((entry) => entry.id !== snapshot.id));
      if (selected?.id === snapshot.id) setSelected(null);
    } catch (failure) {
      setNotice({ tone: "error", text: failure instanceof Error ? failure.message : String(failure) });
    }
  };

  const runDiff = async () => {
    if (!selected || !compareWith) return;
    setDiff(null);
    try {
      // Eski → yeni sırasıyla: "eklenen" yeni yedekte olan demek.
      const other = snapshots?.find((entry) => entry.id === compareWith);
      const [from, to] = other && other.time < selected.time ? [other.id, selected.id] : [selected.id, compareWith];
      setDiff(await api<SnapshotDiff>(`/api/backup/snapshots/diff?jobId=${job.id}&from=${from}&to=${to}`));
    } catch (failure) {
      setNotice({ tone: "error", text: failure instanceof Error ? failure.message : String(failure) });
    }
  };

  const downloadUrl = (entry: { path: string; type: string }) =>
    withHostQuery(
      `/api/backup/download?jobId=${job.id}&snapshotId=${selected?.id}&path=${encodeURIComponent(entry.path)}${entry.type === "dir" ? "&dir=1" : ""}`,
    );

  return (
    <section className={cardClass}>
      <SectionHeader
        icon={History}
        title={t("backup.snapshots.title")}
        aside={snapshots && <span className="text-xs text-subtle">{t("backup.snapshots.count", { count: snapshots.length })}</span>}
      />
      {error && (
        <div className="px-5 pt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {notice && (
        <div className="px-5 pt-4">
          <Notice tone={notice.tone}>{notice.text}</Notice>
        </div>
      )}

      <div className="grid lg:grid-cols-[18rem_minmax(0,1fr)]">
        {/* Liste */}
        <div className="max-h-[36rem] overflow-y-auto border-b border-line thin-scrollbar lg:border-b-0 lg:border-r">
          {snapshots === null ? (
            <p className="px-5 py-8 text-center text-sm text-subtle">{t("backup.common.loading")}</p>
          ) : snapshots.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-subtle">{t("backup.snapshots.empty")}</p>
          ) : (
            grouped.map(([day, list]) => (
              <div key={day}>
                <div className="sticky top-0 bg-surface px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide text-subtle">
                  {day}
                </div>
                <ul>
                  {list.map((snapshot) => (
                    <li key={snapshot.id}>
                      <button
                        type="button"
                        onClick={() => open(snapshot)}
                        className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors hover:bg-canvas ${
                          selected?.id === snapshot.id ? "bg-brand/10 text-brand" : ""
                        }`}
                      >
                        <span className="tabular-nums">{f.time(snapshot.time * 1000)}</span>
                        <code className="font-mono text-[11px] text-subtle">{snapshot.shortId}</code>
                        <span className="ml-auto text-xs text-subtle">{formatBytes(snapshot.sizeBytes)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>

        {/* Gezgin */}
        <div className="min-w-0">
          {!selected ? (
            <p className="px-5 py-12 text-center text-sm text-subtle">{t("backup.snapshots.pick")}</p>
          ) : (
            <div>
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-sm">
                <button type="button" className="text-brand hover:underline" onClick={() => go("/")}>
                  /
                </button>
                {crumbs.map((crumb, index) => (
                  <span key={`${crumb}-${index}`} className="flex items-center gap-1">
                    <ChevronRight className="size-3 text-subtle" aria-hidden />
                    <button
                      type="button"
                      className="text-brand hover:underline"
                      onClick={() => go(`/${crumbs.slice(0, index + 1).join("/")}`)}
                    >
                      {crumb}
                    </button>
                  </span>
                ))}
                <span className="ml-auto text-xs text-subtle">{friendlyPath(path)}</span>
              </div>

              <ul className="max-h-[26rem] divide-y divide-line overflow-y-auto thin-scrollbar">
                {entries === null ? (
                  <li className="px-5 py-8 text-center text-sm text-subtle">{t("backup.common.loading")}</li>
                ) : entries.length === 0 ? (
                  <li className="px-5 py-8 text-center text-sm text-subtle">{t("backup.snapshots.emptyDir")}</li>
                ) : (
                  entries.map((entry) => (
                    <li key={entry.path} className="flex items-center gap-2 px-4 py-1.5 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 shrink-0 accent-[var(--brand)]"
                        checked={picked.has(entry.path)}
                        onChange={() => togglePick(entry.path)}
                        aria-label={entry.name}
                      />
                      {entry.type === "dir" ? (
                        <button
                          type="button"
                          onClick={() => go(entry.path)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-brand"
                        >
                          <Folder className="size-4 shrink-0 text-brand" aria-hidden />
                          <span className="truncate">{entry.name}</span>
                        </button>
                      ) : (
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          {entry.type === "symlink" ? (
                            <Link2 className="size-4 shrink-0 text-subtle" aria-hidden />
                          ) : (
                            <File className="size-4 shrink-0 text-subtle" aria-hidden />
                          )}
                          <span className="truncate">{entry.name}</span>
                        </span>
                      )}
                      <span className="hidden text-xs text-subtle sm:inline">
                        {entry.mtime ? f.dateTime(entry.mtime * 1000) : ""}
                      </span>
                      <span className="w-16 text-right text-xs tabular-nums text-subtle">
                        {entry.type === "file" ? formatBytes(entry.size) : ""}
                      </span>
                      {downloadSupported && (entry.type === "file" || entry.type === "dir") && (
                        <a
                          href={downloadUrl(entry)}
                          className="text-subtle hover:text-brand"
                          title={entry.type === "dir" ? t("backup.snapshots.downloadZip") : t("backup.snapshots.download")}
                        >
                          <Download className="size-4" aria-hidden />
                        </a>
                      )}
                    </li>
                  ))
                )}
              </ul>

              <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
                <span className="text-xs text-subtle">
                  {picked.size > 0
                    ? t("backup.snapshots.picked", { count: picked.size })
                    : t("backup.snapshots.pickedNone")}
                </span>
                <div className="ml-auto flex flex-wrap gap-2">
                  <button type="button" className={buttonClass} onClick={() => setRestore("folder")}>
                    <FolderOutput className="size-4" aria-hidden /> {t("backup.restore.folder")}
                  </button>
                  {category === "os" && (
                    <button type="button" className={buttonClass} onClick={() => setRestore("original")}>
                      <RotateCcw className="size-4" aria-hidden /> {t("backup.restore.original")}
                    </button>
                  )}
                  {category === "docker" && (
                    <button type="button" className={buttonClass} onClick={() => setRestore("container")}>
                      <RotateCcw className="size-4" aria-hidden /> {t("backup.restore.container")}
                    </button>
                  )}
                  {category === "database" && (
                    <button type="button" className={buttonClass} onClick={() => setRestore("database")}>
                      <RotateCcw className="size-4" aria-hidden /> {t("backup.restore.database")}
                    </button>
                  )}
                  <button
                    type="button"
                    className={`${smallButtonClass} hover:border-danger hover:text-danger`}
                    onClick={() => void deleteSnapshot(selected)}
                    title={t("backup.snapshots.delete")}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </div>
              </div>

              {/* Karşılaştır */}
              <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 text-sm">
                <ArrowLeftRight className="size-4 text-subtle" aria-hidden />
                <span className="text-subtle">{t("backup.diff.with")}</span>
                <select
                  className={`${inputClass} max-w-64`}
                  value={compareWith}
                  onChange={(event) => setCompareWith(event.target.value)}
                >
                  <option value="">—</option>
                  {(snapshots ?? [])
                    .filter((entry) => entry.id !== selected.id)
                    .map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {f.dateTime(entry.time * 1000)} · {entry.shortId}
                      </option>
                    ))}
                </select>
                <button type="button" disabled={!compareWith} className={smallButtonClass} onClick={() => void runDiff()}>
                  {t("backup.diff.run")}
                </button>
              </div>
              {diff && <DiffView diff={diff} />}
            </div>
          )}
        </div>
      </div>

      {selected && restore && (
        <RestoreModal
          mode={restore}
          job={job}
          snapshot={selected}
          includes={[...picked]}
          items={items}
          onClose={() => setRestore(null)}
          onStarted={() => {
            setRestore(null);
            setNotice({ tone: "ok", text: t("backup.restore.started") });
            onStarted();
          }}
        />
      )}
    </section>
  );
}

function DiffView({ diff }: { diff: SnapshotDiff }) {
  const t = useT();
  const sections: { key: "added" | "removed" | "changed"; className: string }[] = [
    { key: "added", className: "text-ok" },
    { key: "removed", className: "text-danger" },
    { key: "changed", className: "text-warn" },
  ];
  return (
    <div className="border-t border-line px-4 py-3 text-sm">
      <p className="text-xs text-subtle">
        {t("backup.diff.summary", {
          added: diff.added.length,
          removed: diff.removed.length,
          changed: diff.changed.length,
          addedBytes: formatBytes(diff.addedBytes),
          removedBytes: formatBytes(diff.removedBytes),
        })}
      </p>
      <div className="mt-2 grid gap-3 md:grid-cols-3">
        {sections.map((section) => (
          <div key={section.key}>
            <h4 className={`text-xs font-semibold ${section.className}`}>
              {t(`backup.diff.${section.key}`)} ({diff[section.key].length})
            </h4>
            <ul className="mt-1 max-h-48 overflow-y-auto font-mono text-[11px] text-subtle thin-scrollbar">
              {diff[section.key].map((entry) => (
                <li key={entry} className="truncate" title={entry}>
                  {friendlyPath(entry)}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function RestoreModal({
  mode,
  job,
  snapshot,
  includes,
  items,
  onClose,
  onStarted,
}: {
  mode: RestoreMode;
  job: Pick<BackupJob, "id">;
  snapshot: Snapshot;
  includes: string[];
  items: (DockerItem | OsItem | DbItem)[];
  onClose: () => void;
  onStarted: () => void;
}) {
  const t = useT();
  const f = useFormat();
  const [target, setTarget] = useState(`/root/geri-yukleme-${snapshot.shortId}`);
  const [browsing, setBrowsing] = useState(false);
  const containers = (items as DockerItem[]).filter((item) => "mounts" in item && item.selected).map((item) => item.name);
  const databases = (items as DbItem[]).filter((item) => "credentials" in item && item.kind === "db").map((item) => item.ref);
  const choices = mode === "container" ? containers : mode === "database" ? databases : [];
  const [choice, setChoice] = useState(choices[0] ?? "");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Yıkıcı modlar ad yazdırarak onaylanır.
  const confirmWord = mode === "original" ? t("backup.restore.confirmWord") : mode === "folder" ? "" : choice;
  const confirmed = confirmWord === "" || confirmText.trim() === confirmWord;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/backup/restore", "POST", {
        jobId: job.id,
        snapshotId: snapshot.id,
        mode,
        includes,
        target,
        container: choice,
      });
      onStarted();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setBusy(false);
    }
  };

  return (
    <Modal open title={t(`backup.restore.title.${mode}`)} onClose={onClose}>
      <div className="space-y-4 p-5 text-sm">
        <p className="text-subtle">
          {t("backup.restore.from", { when: f.dateTime(snapshot.time * 1000), id: snapshot.shortId })}
        </p>

        {(mode === "folder" || mode === "original") && (
          <p>
            {includes.length > 0
              ? t("backup.restore.selection", { count: includes.length })
              : t("backup.restore.everything")}
          </p>
        )}

        {mode === "folder" && (
          <label className="block">
            <span className="mb-1 block text-subtle">{t("backup.restore.target")}</span>
            <div className="flex gap-2">
              <input className={`${inputClass} font-mono`} value={target} onChange={(event) => setTarget(event.target.value)} />
              <button type="button" className={smallButtonClass} onClick={() => setBrowsing(true)}>
                {t("backup.common.browse")}
              </button>
            </div>
          </label>
        )}

        {(mode === "container" || mode === "database") && (
          <label className="block">
            <span className="mb-1 block text-subtle">
              {mode === "container" ? t("backup.restore.pickContainer") : t("backup.restore.pickDatabase")}
            </span>
            <select className={inputClass} value={choice} onChange={(event) => setChoice(event.target.value)}>
              {choices.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}

        <Notice tone={mode === "folder" ? "info" : "warn"}>{t(`backup.restore.warning.${mode}`)}</Notice>

        {confirmWord && (
          <label className="block">
            <span className="mb-1 block text-subtle">{t("backup.restore.typeToConfirm", { word: confirmWord })}</span>
            <input className={inputClass} value={confirmText} onChange={(event) => setConfirmText(event.target.value)} />
          </label>
        )}

        {error && <Notice tone="error">{error}</Notice>}

        <div className="flex justify-end gap-2">
          <button type="button" className={buttonClass} onClick={onClose}>
            {t("backup.common.cancel")}
          </button>
          <button
            type="button"
            disabled={busy || !confirmed || ((mode === "container" || mode === "database") && !choice)}
            className={primaryButtonClass}
            onClick={() => void submit()}
          >
            <RotateCcw className="size-4" aria-hidden /> {t("backup.restore.start")}
          </button>
        </div>
      </div>

      <DirBrowser
        open={browsing}
        title={t("backup.restore.target")}
        startPath="/"
        onClose={() => setBrowsing(false)}
        onPick={(path) => {
          setTarget(path);
          setBrowsing(false);
        }}
      />
    </Modal>
  );
}
