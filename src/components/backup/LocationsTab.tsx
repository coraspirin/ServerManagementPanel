"use client";

import Link from "next/link";
import { useState } from "react";
import {
  CheckCircle2,
  Copy,
  FileKey2,
  FolderSearch,
  KeyRound,
  LockOpen,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import { Modal } from "@/components/Modal";
import type { BackupRepo, LiveProgress } from "@/lib/backup/types";
import { copyText } from "@/lib/client/clipboard";
import { useFormat, useT } from "@/lib/i18n/client";
import { api, buttonClass, cardClass, downloadPost, formatBytes, inputClass, primaryButtonClass, smallButtonClass } from "./client";
import { draftFromRepo, EMPTY_LOCATION, LocationForm, locationPayload, type LocationDraft } from "./LocationForm";
import { LiveProgressCard, Notice, SectionHeader } from "./parts";

const VERIFY_PRESETS: { cron: string; label: "monthly" | "weekly" | "off" }[] = [
  { cron: "30 4 1 * *", label: "monthly" },
  { cron: "30 4 * * 0", label: "weekly" },
  { cron: "", label: "off" },
];

export function LocationsTab({
  locations,
  live,
  onChanged,
}: {
  locations: BackupRepo[];
  live: LiveProgress[];
  onChanged: () => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState<LocationDraft | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const verifying = live.filter((run) => run.kind === "verify");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-subtle">{t("backup.locations.intro")}</p>
        <button type="button" className={primaryButtonClass} onClick={() => setEditing({ ...EMPTY_LOCATION })}>
          <Plus className="size-4" aria-hidden /> {t("backup.locations.add")}
        </button>
      </div>

      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {verifying.map((run) => (
        <LiveProgressCard key={run.runId} run={run} title={t("backup.runKind.verify")} />
      ))}

      {locations.length === 0 ? (
        <section className={`${cardClass} px-5 py-10 text-center text-sm text-subtle`}>{t("backup.locations.empty")}</section>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {locations.map((location) => (
            <LocationCard
              key={location.id}
              location={location}
              onEdit={() => setEditing(draftFromRepo(location))}
              onMessage={setMessage}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}

      <section className={`${cardClass} p-5 text-sm`}>
        <h3 className="flex items-center gap-2 font-semibold">
          <FolderSearch className="size-4 text-subtle" aria-hidden /> {t("backup.locations.externalTitle")}
        </h3>
        <p className="mt-1 text-subtle">{t("backup.locations.externalText")}</p>
        <Link href="/settings/updates" className={`${smallButtonClass} mt-3`}>
          {t("backup.locations.externalLink")}
        </Link>
      </section>

      {editing && (
        <LocationModal
          draft={editing}
          onClose={() => setEditing(null)}
          onSaved={(password) => {
            setEditing(null);
            if (password) setCreated(password);
            onChanged();
          }}
        />
      )}
      {created && <PasswordOnce password={created} onClose={() => setCreated(null)} />}
    </div>
  );
}

function LocationCard({
  location,
  onEdit,
  onMessage,
  onChanged,
}: {
  location: BackupRepo;
  onEdit: () => void;
  onMessage: (message: { tone: "ok" | "error"; text: string } | null) => void;
  onChanged: () => void;
}) {
  const t = useT();
  const f = useFormat();
  const [busy, setBusy] = useState<string | null>(null);
  const [reauth, setReauth] = useState<"password" | "kit" | null>(null);

  const action = async (name: string, body: Record<string, unknown> = {}) => {
    setBusy(name);
    onMessage(null);
    try {
      const result = await api<{ ok?: boolean; message?: string; started?: boolean }>(
        `/api/backup/locations/${location.id}/actions`,
        "POST",
        { action: name, ...body },
      );
      if (name === "verify") onMessage({ tone: "ok", text: t("backup.locations.verifyStarted") });
      else if (result.message) onMessage({ tone: result.ok === false ? "error" : "ok", text: result.message });
      else onMessage({ tone: "ok", text: t("backup.locations.done") });
      onChanged();
    } catch (error) {
      onMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!confirm(t("backup.locations.confirmDelete", { name: location.name }))) return;
    try {
      await api(`/api/backup/locations/${location.id}`, "DELETE");
      onChanged();
    } catch (error) {
      onMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  };

  const stats = location.stats;
  const usedRatio = stats?.totalBytes && stats.freeBytes !== null ? 1 - stats.freeBytes / stats.totalBytes : null;
  const verifyPreset = VERIFY_PRESETS.find((preset) => preset.cron === location.verifyCron);

  return (
    <section className={cardClass}>
      <SectionHeader
        icon={MapPin}
        title={location.name}
        aside={
          location.initialized ? (
            <span className="flex items-center gap-1 text-xs text-ok">
              <CheckCircle2 className="size-3.5" aria-hidden /> {t("backup.locations.ready")}
            </span>
          ) : (
            <span className="text-xs text-subtle">{t("backup.locations.notInitialized")}</span>
          )
        }
      />
      <div className="space-y-3 px-5 py-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded border border-line px-1.5 text-[11px] text-subtle">{t(`backup.locationKind.${location.kind}`)}</span>
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-subtle" title={location.location}>
            {location.location}
          </code>
        </div>

        {!location.passwordReadable && <Notice tone="error">{t("backup.warnings.password", { name: location.name })}</Notice>}
        {location.lastError && (
          <Notice tone="error">
            <span className="line-clamp-3">{location.lastError}</span>
          </Notice>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
          <div>
            <dt className="text-xs text-subtle">{t("backup.locations.stored")}</dt>
            <dd className="font-medium tabular-nums">{formatBytes(stats?.storedBytes)}</dd>
          </div>
          <div>
            <dt className="text-xs text-subtle">{t("backup.locations.raw")}</dt>
            <dd className="font-medium tabular-nums">{formatBytes(stats?.rawBytes)}</dd>
          </div>
          <div>
            <dt className="text-xs text-subtle">{t("backup.locations.snapshots")}</dt>
            <dd className="font-medium tabular-nums">{stats?.snapshots ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-subtle">{t("backup.locations.systems")}</dt>
            <dd className="font-medium tabular-nums">{location.jobCount}</dd>
          </div>
        </dl>

        {usedRatio !== null && stats && (
          <div>
            <div className="h-1.5 overflow-hidden rounded-full bg-line">
              <div
                className={`h-full ${usedRatio > 0.9 ? "bg-danger" : usedRatio > 0.75 ? "bg-warn" : "bg-ok"}`}
                style={{ width: `${Math.round(usedRatio * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-subtle">
              {t("backup.locations.free", { free: formatBytes(stats.freeBytes), total: formatBytes(stats.totalBytes) })}
            </p>
          </div>
        )}

        <div className="rounded-md border border-line px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck
              className={`size-4 ${location.lastVerifyStatus === "error" ? "text-danger" : location.lastVerifyStatus === "ok" ? "text-ok" : "text-subtle"}`}
              aria-hidden
            />
            <span className="font-medium">{t("backup.locations.verifyTitle")}</span>
            <span className="text-xs text-subtle">
              {location.lastVerifyAt
                ? t(`backup.locations.verify.${location.lastVerifyStatus === "error" ? "failed" : "passed"}`, {
                    when: f.relative(location.lastVerifyAt * 1000),
                  })
                : t("backup.locations.verify.never")}
            </span>
          </div>
          {location.lastVerifyDetail && (
            <p className="mt-1 line-clamp-3 text-xs text-subtle" title={location.lastVerifyDetail}>
              {location.lastVerifyDetail}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-subtle">{t("backup.locations.verifySchedule")}</span>
            {VERIFY_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => void action("verifySchedule", { cron: preset.cron })}
                className={`${smallButtonClass} ${verifyPreset?.cron === preset.cron ? "border-brand bg-brand/10 text-brand" : ""}`}
              >
                {t(`backup.locations.verifyPreset.${preset.label}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" disabled={busy !== null} className={smallButtonClass} onClick={() => void action("test")}>
            <CheckCircle2 className="size-3.5" aria-hidden /> {t("backup.locations.test")}
          </button>
          <button type="button" disabled={busy !== null || !location.initialized} className={smallButtonClass} onClick={() => void action("verify")}>
            <ShieldCheck className="size-3.5" aria-hidden /> {t("backup.locations.verifyNow")}
          </button>
          <button type="button" disabled={busy !== null} className={smallButtonClass} onClick={() => void action("stats")}>
            <RefreshCw className={`size-3.5 ${busy === "stats" ? "animate-spin" : ""}`} aria-hidden /> {t("backup.locations.refresh")}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            className={smallButtonClass}
            title={t("backup.locations.unlockHint")}
            onClick={() => {
              if (confirm(t("backup.locations.confirmUnlock"))) void action("unlock");
            }}
          >
            <LockOpen className="size-3.5" aria-hidden /> {t("backup.locations.unlock")}
          </button>
          <button type="button" className={smallButtonClass} onClick={() => setReauth("password")}>
            <KeyRound className="size-3.5" aria-hidden /> {t("backup.locations.showPassword")}
          </button>
          <button type="button" className={smallButtonClass} onClick={() => setReauth("kit")}>
            <FileKey2 className="size-3.5" aria-hidden /> {t("backup.locations.kit")}
          </button>
          <button type="button" className={smallButtonClass} onClick={onEdit}>
            <Pencil className="size-3.5" aria-hidden /> {t("backup.common.edit")}
          </button>
          <button
            type="button"
            disabled={location.jobCount > 0}
            title={location.jobCount > 0 ? t("backup.locations.inUse") : undefined}
            className={`${smallButtonClass} hover:border-danger hover:text-danger`}
            onClick={() => void remove()}
          >
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>

      {reauth && <ReauthModal mode={reauth} location={location} onClose={() => setReauth(null)} />}
    </section>
  );
}

function LocationModal({
  draft: initial,
  onClose,
  onSaved,
}: {
  draft: LocationDraft;
  onClose: () => void;
  onSaved: (password: string | null) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = initial.id !== undefined;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = locationPayload(draft);
      if (editing) {
        await api(`/api/backup/locations/${initial.id}`, "PUT", payload);
        onSaved(null);
      } else {
        const result = await api<{ id: number; password: string | null }>("/api/backup/locations", "POST", payload);
        onSaved(result.password);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setBusy(false);
    }
  };

  return (
    <Modal open wide title={editing ? t("backup.locations.editTitle") : t("backup.locations.add")} onClose={onClose}>
      <div className="space-y-4 p-5">
        <LocationForm draft={draft} onChange={setDraft} editing={editing} />
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
    </Modal>
  );
}

/** Yeni konumun parolası — bir kez gösterilir. */
export function PasswordOnce({ password, onClose }: { password: string; onClose: () => void }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <Modal open title={t("backup.password.title")} onClose={onClose}>
      <div className="space-y-4 p-5 text-sm">
        <Notice tone="warn">
          <span className="flex gap-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t("backup.password.warning")}
          </span>
        </Notice>
        <div className="flex gap-2">
          <code className="min-w-0 flex-1 break-all rounded-md border border-line bg-canvas px-3 py-2 font-mono">{password}</code>
          <button
            type="button"
            className={smallButtonClass}
            onClick={async () => {
              setCopied(await copyText(password));
            }}
          >
            <Copy className="size-3.5" aria-hidden /> {copied ? t("backup.password.copied") : t("backup.password.copy")}
          </button>
        </div>
        <p className="text-xs text-subtle">{t("backup.password.kitHint")}</p>
        <div className="flex justify-end">
          <button type="button" className={primaryButtonClass} onClick={onClose}>
            {t("backup.password.saved")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ReauthModal({ mode, location, onClose }: { mode: "password" | "kit"; location: BackupRepo; onClose: () => void }) {
  const t = useT();
  const [currentPassword, setCurrentPassword] = useState("");
  const [includeMasterKey, setIncludeMasterKey] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === "password") {
        const result = await api<{ password: string }>(`/api/backup/locations/${location.id}/actions`, "POST", {
          action: "password",
          currentPassword,
        });
        setRevealed(result.password);
      } else {
        await downloadPost(
          `/api/backup/locations/${location.id}/actions`,
          { action: "kit", currentPassword, includeMasterKey },
          "kurtarma-kiti.txt",
        );
        onClose();
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  if (revealed) return <PasswordOnce password={revealed} onClose={onClose} />;

  return (
    <Modal open title={mode === "password" ? t("backup.locations.showPassword") : t("backup.locations.kit")} onClose={onClose}>
      <form
        className="space-y-4 p-5 text-sm"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="text-subtle">{mode === "kit" ? t("backup.kit.text") : t("backup.reauth.text")}</p>
        <label className="block">
          <span className="mb-1 block text-subtle">{t("backup.reauth.password")}</span>
          <input
            type="password"
            autoComplete="current-password"
            className={inputClass}
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </label>
        {mode === "kit" && (
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--brand)]"
              checked={includeMasterKey}
              onChange={(event) => setIncludeMasterKey(event.target.checked)}
            />
            <span>
              {t("backup.kit.masterKey")}
              <span className="block text-xs text-subtle">{t("backup.kit.masterKeyHint")}</span>
            </span>
          </label>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonClass} onClick={onClose}>
            {t("backup.common.cancel")}
          </button>
          <button type="submit" disabled={busy || currentPassword.length === 0} className={primaryButtonClass}>
            {mode === "kit" ? t("backup.kit.download") : t("backup.locations.showPassword")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
