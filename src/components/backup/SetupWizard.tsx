"use client";

import { useState } from "react";
import { Boxes, Check, Database, Server } from "lucide-react";

import { Modal } from "@/components/Modal";
import type { BackupRepo, SystemCategory } from "@/lib/backup/types";
import { useT } from "@/lib/i18n/client";
import { api, buttonClass, inputClass, primaryButtonClass } from "./client";
import { EMPTY_LOCATION, LocationForm, locationPayload, type LocationDraft } from "./LocationForm";
import { PasswordOnce } from "./LocationsTab";
import { Notice, Toggle } from "./parts";

/**
 * "Yedeklemeyi kur" — dört adım: konum → neler → ne zaman → kur ve ilk yedeği
 * al. Neyin yedekleneceğini panel kendisi bulur; kullanıcı yalnızca seçer.
 */

const SYSTEMS: { id: SystemCategory; icon: typeof Boxes }[] = [
  { id: "docker", icon: Boxes },
  { id: "os", icon: Server },
  { id: "database", icon: Database },
];

const SCHEDULES: { cron: string; label: "nightly" | "sixHours" | "weekly" | "manual" }[] = [
  { cron: "0 2 * * *", label: "nightly" },
  { cron: "0 */6 * * *", label: "sixHours" },
  { cron: "0 3 * * 0", label: "weekly" },
  { cron: "", label: "manual" },
];

export function SetupWizard({
  open,
  locations,
  onClose,
  onDone,
}: {
  open: boolean;
  locations: BackupRepo[];
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const [step, setStep] = useState(0);
  const [useExisting, setUseExisting] = useState<number>(0);
  const [draft, setDraft] = useState<LocationDraft>({ ...EMPTY_LOCATION });
  const [systems, setSystems] = useState<Set<SystemCategory>>(new Set(["docker", "os", "database"]));
  const [scheduleCron, setScheduleCron] = useState("0 2 * * *");
  const [keepLast, setKeepLast] = useState(7);
  const [notifySuccess, setNotifySuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  if (!open) return null;

  const steps = [t("backup.setup.step.location"), t("backup.setup.step.what"), t("backup.setup.step.when")];
  const locationReady =
    useExisting > 0 ||
    (draft.kind === "local" && draft.path.trim().startsWith("/")) ||
    (draft.kind === "smb" && draft.server && draft.share) ||
    (draft.kind === "nfs" && draft.server && draft.path) ||
    (draft.kind === "s3" && draft.bucket && draft.username && draft.secret) ||
    (draft.kind === "rclone" && draft.rcloneRemote);

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ password: string | null; warnings: string[] }>("/api/backup/setup", "POST", {
        ...(useExisting > 0 ? { locationId: useExisting } : { location: locationPayload(draft) }),
        systems: [...systems],
        scheduleCron,
        keepLast,
        notifySuccess,
        runNow: true,
      });
      setWarnings(result.warnings);
      if (result.password) setPassword(result.password);
      else onDone();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  if (password) {
    return (
      <PasswordOnce
        password={password}
        onClose={() => {
          setPassword(null);
          onDone();
        }}
      />
    );
  }

  return (
    <Modal open wide title={t("backup.setup.title")} onClose={onClose}>
      <div className="p-5">
        <ol className="mb-5 flex flex-wrap gap-2 text-xs">
          {steps.map((label, index) => (
            <li
              key={label}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${
                index === step ? "border-brand bg-brand/10 text-brand" : index < step ? "border-ok/40 text-ok" : "border-line text-subtle"
              }`}
            >
              {index < step ? <Check className="size-3" aria-hidden /> : <span>{index + 1}</span>}
              {label}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <div className="space-y-4">
            <p className="text-sm text-subtle">{t("backup.setup.locationText")}</p>
            {locations.length > 0 && (
              <label className="block text-sm">
                <span className="mb-1 block text-subtle">{t("backup.setup.existing")}</span>
                <select className={inputClass} value={useExisting} onChange={(event) => setUseExisting(Number(event.target.value))}>
                  <option value={0}>{t("backup.setup.newLocation")}</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name} — {location.location}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {useExisting === 0 && <LocationForm draft={draft} onChange={setDraft} />}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-subtle">{t("backup.setup.whatText")}</p>
            <div className="grid gap-3 md:grid-cols-3">
              {SYSTEMS.map(({ id, icon: Icon }) => {
                const on = systems.has(id);
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setSystems((current) => {
                        const next = new Set(current);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      })
                    }
                    className={`flex flex-col gap-2 rounded-lg border p-4 text-left transition-colors ${
                      on ? "border-brand bg-brand/10" : "border-line hover:border-brand"
                    }`}
                  >
                    <span className="flex items-center gap-2 font-semibold">
                      <Icon className="size-5" aria-hidden /> {t(`backup.category.${id}`)}
                      {on && <Check className="ml-auto size-4 text-brand" aria-hidden />}
                    </span>
                    <span className="text-xs text-subtle">{t(`backup.setup.what.${id}`)}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-subtle">{t("backup.setup.whatHint")}</p>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 text-sm">
            <div>
              <span className="mb-2 block text-subtle">{t("backup.system.schedule")}</span>
              <div className="flex flex-wrap gap-2">
                {SCHEDULES.map((entry) => (
                  <button
                    key={entry.label}
                    type="button"
                    onClick={() => setScheduleCron(entry.cron)}
                    className={`${buttonClass} ${scheduleCron === entry.cron ? "border-brand bg-brand/10 text-brand" : ""}`}
                  >
                    {t(`backup.schedule.${entry.label}`)}
                  </button>
                ))}
              </div>
            </div>
            <label className="block">
              <span className="mb-1 block text-subtle">{t("backup.system.keepLast")}</span>
              <input
                type="number"
                min={1}
                max={1000}
                className={`${inputClass} max-w-32`}
                value={keepLast}
                onChange={(event) => setKeepLast(Number(event.target.value))}
              />
              <span className="mt-1 block text-xs text-subtle">{t("backup.system.keepLastHint")}</span>
            </label>
            <Toggle
              checked={notifySuccess}
              onChange={setNotifySuccess}
              label={t("backup.system.notifySuccess")}
              hint={t("backup.system.notifySuccessHint")}
            />
            <Notice tone="info">{t("backup.setup.defaultsHint")}</Notice>
          </div>
        )}

        {error && (
          <div className="mt-4">
            <Notice tone="error">{error}</Notice>
          </div>
        )}
        {warnings.length > 0 && (
          <div className="mt-4">
            <Notice tone="warn">{warnings.join(" · ")}</Notice>
          </div>
        )}

        <div className="mt-6 flex justify-between gap-2">
          <button type="button" className={buttonClass} onClick={() => (step === 0 ? onClose() : setStep(step - 1))}>
            {step === 0 ? t("backup.common.cancel") : t("backup.common.back")}
          </button>
          {step < 2 ? (
            <button
              type="button"
              disabled={(step === 0 && !locationReady) || (step === 1 && systems.size === 0)}
              className={primaryButtonClass}
              onClick={() => setStep(step + 1)}
            >
              {t("backup.common.continue")}
            </button>
          ) : (
            <button type="button" disabled={busy} className={primaryButtonClass} onClick={() => void finish()}>
              {busy ? t("backup.setup.working") : t("backup.setup.finish")}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
