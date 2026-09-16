"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Pencil, Play, Plus, Trash2, Wrench } from "lucide-react";
import { Modal } from "@/components/Modal";
import {
  MaintenanceForm,
  emptyMaintenanceForm,
  fromLocalInput,
  timeToMinute,
  windowToForm,
  type MaintenanceFormValues,
} from "@/components/monitors/MaintenanceForm";
import {
  MonitorForm,
  emptyMonitorForm,
  monitorToForm,
  type GlobalDefaults,
  type MonitorFormValues,
} from "@/components/monitors/MonitorForm";
import { UptimeBars } from "@/components/monitors/UptimeBars";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import type { MaintenanceWindow, MonitorView } from "@/lib/monitors/types";
import { useDynamicT, useFormat, useT } from "@/lib/i18n/client";
import type { MessageKey, TFunction } from "@/lib/i18n/translate";

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function statusStyle(monitor: MonitorView): { dot: string; text: string; label: MessageKey } {
  if (monitor.inMaintenance) {
    return { dot: "bg-brand", text: "text-brand", label: "uptime.status.maintenance" };
  }
  if (!monitor.enabled) return { dot: "bg-line", text: "text-subtle", label: "uptime.status.disabled" };
  if (monitor.status === "up") return { dot: "bg-ok", text: "text-ok", label: "uptime.status.up" };
  if (monitor.status === "down") {
    return { dot: "bg-danger", text: "text-danger", label: "uptime.status.down" };
  }
  return { dot: "bg-line", text: "text-subtle", label: "uptime.status.pending" };
}

type Format = ReturnType<typeof useFormat>;

function uptimePct(value: number | null, f: Format): string {
  return value === null ? "—" : f.pct(value, value >= 99.95 ? 2 : 1);
}

const WINDOW_TIME: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
};

function describeWindow(
  window: MaintenanceWindow,
  monitors: MonitorView[],
  t: TFunction,
  f: Format,
): string {
  const scope =
    window.monitorId === null
      ? t("uptime.allServices")
      : (monitors.find((m) => m.id === window.monitorId)?.name ?? t("uptime.deletedService"));

  if (window.kind === "once") {
    const fmt = (ts: number | null) => (ts === null ? "?" : f.dateTime(ts * 1000, WINDOW_TIME));
    return `${fmt(window.startsAt)} – ${fmt(window.endsAt)} · ${scope}`;
  }

  const days = window.weekdays.map((d) => f.weekday(d, "short")).join(", ");
  const time = (minute: number | null) =>
    minute === null
      ? "?"
      : `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  return `${days} · ${time(window.startMinute)}–${time(window.endMinute)} · ${scope}`;
}

type Props = {
  initialMonitors: MonitorView[];
  initialWindows: MaintenanceWindow[];
  defaults: GlobalDefaults;
  canManage: boolean;
  refreshSeconds: number;
};

export function UptimeScreen({
  initialMonitors,
  initialWindows,
  defaults,
  canManage,
  refreshSeconds,
}: Props) {
  const t = useT();
  const dt = useDynamicT();
  const f = useFormat();
  const [monitors, setMonitors] = useState(initialMonitors);
  const [windows, setWindows] = useState(initialWindows);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [monitorModal, setMonitorModal] = useState<{
    open: boolean;
    id: number | null;
    values: MonitorFormValues;
  }>({ open: false, id: null, values: emptyMonitorForm(defaults) });

  const [windowModal, setWindowModal] = useState<{
    open: boolean;
    id: number | null;
    values: MaintenanceFormValues;
  }>({ open: false, id: null, values: emptyMaintenanceForm() });

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const [monitorResponse, windowResponse] = await Promise.all([
        fetch("/api/monitors", { signal, cache: "no-store" }),
        fetch("/api/maintenance", { signal, cache: "no-store" }),
      ]);
      if (monitorResponse.ok) {
        setMonitors(((await monitorResponse.json()) as { monitors: MonitorView[] }).monitors);
      }
      if (windowResponse.ok) {
        setWindows(((await windowResponse.json()) as { windows: MaintenanceWindow[] }).windows);
      }
    } catch {
      // Ağ hatası: ekran son bilinen durumu göstermeye devam eder.
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setInterval(
      () => void refresh(controller.signal),
      Math.max(5, refreshSeconds) * 1000,
    );
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [refresh, refreshSeconds]);

  async function send(
    url: string,
    method: string,
    body?: unknown,
  ): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setFormError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = (await response.json()) as Record<string, unknown>;

      if (!response.ok) {
        setFormError((data.error as string) ?? t("common.errors.actionFailed"));
        return null;
      }
      if (Array.isArray(data.monitors)) setMonitors(data.monitors as MonitorView[]);
      if (Array.isArray(data.windows)) setWindows(data.windows as MaintenanceWindow[]);
      return data;
    } catch {
      setFormError(t("common.errors.network"));
      return null;
    } finally {
      setBusy(false);
    }
  }

  function monitorPayload(values: MonitorFormValues) {
    const optional = (raw: string) => (raw.trim() === "" ? null : Number(raw));
    return {
      name: values.name,
      type: values.type,
      target: values.target,
      expected: values.expected,
      enabled: values.enabled,
      ignoreTls: values.ignoreTls,
      intervalSeconds: optional(values.intervalSeconds),
      timeoutSeconds: optional(values.timeoutSeconds),
      retries: optional(values.retries),
      downThreshold: optional(values.downThreshold),
    };
  }

  async function saveMonitor() {
    const payload = monitorPayload(monitorModal.values);
    const result =
      monitorModal.id === null
        ? await send("/api/monitors", "POST", payload)
        : await send(`/api/monitors/${monitorModal.id}`, "PATCH", payload);

    if (result) setMonitorModal((m) => ({ ...m, open: false }));
  }

  async function saveWindow() {
    const values = windowModal.values;
    const payload = {
      name: values.name,
      kind: values.kind,
      startsAt: values.kind === "once" ? fromLocalInput(values.startsAtLocal) : null,
      endsAt: values.kind === "once" ? fromLocalInput(values.endsAtLocal) : null,
      weekdays: values.kind === "weekly" ? values.weekdays : [],
      startMinute: values.kind === "weekly" ? timeToMinute(values.startTime) : null,
      endMinute: values.kind === "weekly" ? timeToMinute(values.endTime) : null,
      monitorId: values.monitorId === "" ? null : Number(values.monitorId),
      enabled: values.enabled,
    };

    const result =
      windowModal.id === null
        ? await send("/api/maintenance", "POST", payload)
        : await send(`/api/maintenance/${windowModal.id}`, "PATCH", payload);

    if (result) setWindowModal((w) => ({ ...w, open: false }));
  }

  async function checkNow(monitor: MonitorView) {
    const result = await send(`/api/monitors/${monitor.id}/check`, "POST");
    if (!result) return;
    setNotice(
      result.ok
        ? t("uptime.checkOk", { name: monitor.name, ms: String(result.latencyMs) })
        : `${monitor.name}: ${result.error ?? t("uptime.noResponse")}`,
    );
    setTimeout(() => setNotice(null), 5000);
  }

  const down = monitors.filter((m) => m.enabled && !m.inMaintenance && m.status === "down");
  const inMaintenance = monitors.filter((m) => m.inMaintenance);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <span className="font-medium">{t("uptime.serviceCount", { count: monitors.length })}</span>
          {down.length > 0 && (
            <span className="text-danger">{t("uptime.downCount", { count: down.length })}</span>
          )}
          {inMaintenance.length > 0 && (
            <span className="text-brand">
              {t("uptime.maintenanceCount", { count: inMaintenance.length })}
            </span>
          )}
          {monitors.length > 0 && down.length === 0 && inMaintenance.length === 0 && (
            <span className="text-ok">{t("uptime.allUp")}</span>
          )}
        </div>

        {canManage && (
          <button
            type="button"
            onClick={() => {
              setFormError(null);
              setMonitorModal({ open: true, id: null, values: emptyMonitorForm(defaults) });
            }}
            className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white"
          >
            <Plus className="size-4" /> {t("uptime.addService")}
          </button>
        )}
      </div>

      {notice && (
        <p className="rounded-md border border-line bg-surface px-4 py-2 text-sm">{notice}</p>
      )}

      {monitors.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-surface px-5 py-8 text-center text-sm text-subtle">
          {t("uptime.empty")}
        </p>
      ) : (
        <div className="space-y-3">
          {monitors.map((monitor) => {
            const style = statusStyle(monitor);
            const typeLabel = dt(`monitorType.${monitor.type}.label`);

            return (
              <section
                key={monitor.id}
                className="rounded-lg border border-line bg-surface p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`size-2.5 shrink-0 rounded-full ${style.dot}`} />
                      <span className="font-medium">{monitor.name}</span>
                      <span className={`text-xs ${style.text}`}>{t(style.label)}</span>
                      <span className="rounded border border-line px-1 text-[10px] text-subtle">
                        {typeLabel}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-subtle">
                      {monitor.target}
                    </p>
                    {monitor.status === "down" && monitor.lastError && (
                      <p className="mt-1 text-xs text-danger">{monitor.lastError}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right text-xs">
                      <div className="text-subtle">{t("uptime.hours24")}</div>
                      <div className="font-medium">{uptimePct(monitor.uptime24h, f)}</div>
                    </div>
                    <div className="text-right text-xs">
                      <div className="text-subtle">{t("uptime.days30")}</div>
                      <div className="font-medium">{uptimePct(monitor.uptime30d, f)}</div>
                    </div>
                    <div className="text-right text-xs">
                      <div className="text-subtle">{t("uptime.response")}</div>
                      <div className="font-medium">
                        {monitor.lastLatencyMs === null ? "—" : `${monitor.lastLatencyMs} ms`}
                      </div>
                    </div>

                    {canManage && (
                      <div className="flex items-center gap-1">
                        <IconButton
                          title={t("uptime.checkNow")}
                          onClick={() => void checkNow(monitor)}
                          disabled={busy}
                        >
                          <Play className="size-3.5" />
                        </IconButton>
                        <IconButton
                          title={t("common.actions.edit")}
                          onClick={() => {
                            setFormError(null);
                            setMonitorModal({
                              open: true,
                              id: monitor.id,
                              values: monitorToForm(monitor, defaults),
                            });
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </IconButton>
                        <IconButton
                          title={t("common.actions.delete")}
                          danger
                          onClick={() => {
                            if (confirm(t("uptime.confirmDelete", { name: monitor.name }))) {
                              void send(`/api/monitors/${monitor.id}`, "DELETE");
                            }
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </IconButton>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-3">
                  <UptimeBars days={monitor.days} />
                  <div className="mt-1 flex justify-between text-[10px] text-subtle">
                    <span>{t("uptime.daysAgo", { count: monitor.days.length })}</span>
                    <span>
                      {t("uptime.lastCheck", {
                        when: monitor.lastCheckAt ? f.relative(monitor.lastCheckAt * 1000) : "—",
                        seconds: monitor.effective.intervalSeconds,
                      })}
                    </span>
                    <span>{t("uptime.today")}</span>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}

      <section className="rounded-lg border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
          <div>
            <h2 className="flex items-center gap-1.5 font-semibold">
              <Wrench className="size-4" /> {t("uptime.windows")}
            </h2>
            <p className="mt-0.5 text-xs text-subtle">
              {t("uptime.windowsIntro")}
            </p>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={() => {
                setFormError(null);
                setWindowModal({ open: true, id: null, values: emptyMaintenanceForm() });
              }}
              className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs transition-colors hover:border-brand hover:text-brand"
            >
              <Plus className="size-3.5" /> {t("uptime.addWindow")}
            </button>
          )}
        </div>

        {windows.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-subtle">
            {t("uptime.noWindows")}
          </p>
        ) : (
          <div className="divide-y divide-line">
            {windows.map((window) => (
              <div
                key={window.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <CalendarClock className="size-3.5 shrink-0 text-subtle" />
                    <span className="text-sm font-medium">{window.name}</span>
                    {window.active && (
                      <span className="rounded bg-brand/15 px-1.5 text-[10px] font-medium text-brand">
                        {t("uptime.activeNow")}
                      </span>
                    )}
                    {!window.enabled && (
                      <span className="rounded bg-line px-1.5 text-[10px] text-subtle">
                        {t("uptime.status.disabled")}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-subtle">
                    {describeWindow(window, monitors, t, f)}
                  </p>
                </div>

                {canManage && (
                  <div className="flex items-center gap-1">
                    <IconButton
                      title={t("common.actions.edit")}
                      onClick={() => {
                        setFormError(null);
                        setWindowModal({
                          open: true,
                          id: window.id,
                          values: windowToForm(window),
                        });
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </IconButton>
                    <IconButton
                      title={t("common.actions.delete")}
                      danger
                      onClick={() => {
                        if (confirm(t("uptime.confirmDelete", { name: window.name }))) {
                          void send(`/api/maintenance/${window.id}`, "DELETE");
                        }
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <Modal
        open={monitorModal.open}
        title={monitorModal.id === null ? t("uptime.addService") : t("uptime.editService")}
        onClose={() => setMonitorModal((m) => ({ ...m, open: false }))}
      >
        <MonitorForm
          values={monitorModal.values}
          defaults={defaults}
          busy={busy}
          error={formError}
          onChange={(patch) =>
            setMonitorModal((m) => ({ ...m, values: { ...m.values, ...patch } }))
          }
          onSubmit={() => void saveMonitor()}
          onCancel={() => setMonitorModal((m) => ({ ...m, open: false }))}
        />
      </Modal>

      <Modal
        open={windowModal.open}
        title={windowModal.id === null ? t("uptime.addWindowTitle") : t("uptime.editWindowTitle")}
        onClose={() => setWindowModal((w) => ({ ...w, open: false }))}
      >
        <MaintenanceForm
          values={windowModal.values}
          monitors={monitors}
          busy={busy}
          error={formError}
          onChange={(patch) =>
            setWindowModal((w) => ({ ...w, values: { ...w.values, ...patch } }))
          }
          onSubmit={() => void saveWindow()}
          onCancel={() => setWindowModal((w) => ({ ...w, open: false }))}
        />
      </Modal>
    </div>
  );
}

function IconButton({
  title,
  onClick,
  disabled,
  danger,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={`rounded border border-line p-1.5 text-subtle transition-colors disabled:opacity-50 ${
        danger ? "hover:border-danger hover:text-danger" : "hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
