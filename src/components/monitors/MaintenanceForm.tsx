"use client";

import { useFormat, useT } from "@/lib/i18n/client";
import type { MaintenanceKind, MaintenanceWindow, Monitor } from "@/lib/monitors/types";

/**
 * Bakım penceresi formu (M1.2).
 *
 * Pencere içindeyken servis kontrol edilmeye devam eder ama kesinti sayılmaz:
 * planlı bir yeniden başlatma kullanılabilirlik yüzdesini düşürmemeli ve
 * (M1.3'ten itibaren) gece yarısı telefon çaldırmamalı.
 */

export type MaintenanceFormValues = {
  name: string;
  kind: MaintenanceKind;
  startsAtLocal: string;
  endsAtLocal: string;
  weekdays: number[];
  startTime: string;
  endTime: string;
  monitorId: string;
  enabled: boolean;
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function toLocalInput(ts: number | null): string {
  if (ts === null) return "";
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): number | null {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? Math.floor(ts / 1000) : null;
}

export function minuteToTime(minute: number | null): string {
  if (minute === null) return "";
  return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
}

export function timeToMinute(value: string): number | null {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function emptyMaintenanceForm(): MaintenanceFormValues {
  const now = new Date();
  const inTwoHours = new Date(now.getTime() + 2 * 3600 * 1000);
  return {
    name: "",
    kind: "once",
    startsAtLocal: toLocalInput(Math.floor(now.getTime() / 1000)),
    endsAtLocal: toLocalInput(Math.floor(inTwoHours.getTime() / 1000)),
    weekdays: [0],
    startTime: "03:00",
    endTime: "05:00",
    monitorId: "",
    enabled: true,
  };
}

export function windowToForm(window: MaintenanceWindow): MaintenanceFormValues {
  return {
    name: window.name,
    kind: window.kind,
    startsAtLocal: toLocalInput(window.startsAt),
    endsAtLocal: toLocalInput(window.endsAt),
    weekdays: window.weekdays.length > 0 ? window.weekdays : [0],
    startTime: minuteToTime(window.startMinute) || "03:00",
    endTime: minuteToTime(window.endMinute) || "05:00",
    monitorId: window.monitorId === null ? "" : String(window.monitorId),
    enabled: window.enabled,
  };
}

const inputClass =
  "w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand";

export function MaintenanceForm({
  values,
  monitors,
  busy,
  error,
  onChange,
  onSubmit,
  onCancel,
}: {
  values: MaintenanceFormValues;
  monitors: Monitor[];
  busy: boolean;
  error: string | null;
  onChange: (patch: Partial<MaintenanceFormValues>) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const f = useFormat();
  const crossesMidnight =
    values.kind === "weekly" &&
    (timeToMinute(values.startTime) ?? 0) > (timeToMinute(values.endTime) ?? 0);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <label className="block">
        <span className="text-xs font-medium">{t("users.roles.name")}</span>
        <input
          type="text"
          value={values.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder={t("maintenanceForm.namePlaceholder")}
          className={`mt-1 ${inputClass}`}
          autoFocus
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium">{t("maintenanceForm.repeat")}</span>
          <select
            value={values.kind}
            onChange={(e) => onChange({ kind: e.target.value as MaintenanceKind })}
            className={`mt-1 ${inputClass}`}
          >
            <option value="once">{t("maintenanceForm.once")}</option>
            <option value="weekly">{t("maintenanceForm.weekly")}</option>
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium">{t("maintenanceForm.scope")}</span>
          <select
            value={values.monitorId}
            onChange={(e) => onChange({ monitorId: e.target.value })}
            className={`mt-1 ${inputClass}`}
          >
            <option value="">{t("maintenanceForm.allServices")}</option>
            {monitors.map((monitor) => (
              <option key={monitor.id} value={monitor.id}>
                {monitor.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {values.kind === "once" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium">{t("maintenanceForm.start")}</span>
            <input
              type="datetime-local"
              value={values.startsAtLocal}
              onChange={(e) => onChange({ startsAtLocal: e.target.value })}
              className={`mt-1 ${inputClass}`}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium">{t("maintenanceForm.end")}</span>
            <input
              type="datetime-local"
              value={values.endsAtLocal}
              onChange={(e) => onChange({ endsAtLocal: e.target.value })}
              className={`mt-1 ${inputClass}`}
            />
          </label>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <span className="text-xs font-medium">{t("maintenanceForm.days")}</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {[0, 1, 2, 3, 4, 5, 6].map((index) => {
                const selected = values.weekdays.includes(index);
                return (
                  <button
                    key={index}
                    type="button"
                    onClick={() =>
                      onChange({
                        weekdays: selected
                          ? values.weekdays.filter((d) => d !== index)
                          : [...values.weekdays, index].sort(),
                      })
                    }
                    className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                      selected
                        ? "border-brand bg-brand/10 text-brand"
                        : "border-line text-subtle hover:text-ink"
                    }`}
                  >
                    {f.weekday(index, "short")}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium">{t("maintenanceForm.startTime")}</span>
              <input
                type="time"
                value={values.startTime}
                onChange={(e) => onChange({ startTime: e.target.value })}
                className={`mt-1 ${inputClass}`}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium">{t("maintenanceForm.endTime")}</span>
              <input
                type="time"
                value={values.endTime}
                onChange={(e) => onChange({ endTime: e.target.value })}
                className={`mt-1 ${inputClass}`}
              />
            </label>
          </div>

          {crossesMidnight && (
            <p className="text-[11px] text-subtle">
              {t("maintenanceForm.crossesMidnight")}
            </p>
          )}
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={values.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
          className="size-4 accent-[var(--brand)]"
        />
        {t("proxy.form.enabled")}
      </label>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:text-ink"
        >
          {t("common.actions.cancel")}
        </button>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity disabled:opacity-50"
        >
          {busy ? t("common.states.saving") : t("common.actions.save")}
        </button>
      </div>
    </form>
  );
}
