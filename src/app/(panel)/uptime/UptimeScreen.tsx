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
import { WEEKDAY_NAMES } from "@/lib/cron/friendly";
import { MONITOR_TYPES, type MaintenanceWindow, type MonitorView } from "@/lib/monitors/types";

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function statusStyle(monitor: MonitorView): { dot: string; text: string; label: string } {
  if (monitor.inMaintenance) {
    return { dot: "bg-brand", text: "text-brand", label: "bakımda" };
  }
  if (!monitor.enabled) return { dot: "bg-line", text: "text-subtle", label: "kapalı" };
  if (monitor.status === "up") return { dot: "bg-ok", text: "text-ok", label: "çalışıyor" };
  if (monitor.status === "down") {
    return { dot: "bg-danger", text: "text-danger", label: "çevrimdışı" };
  }
  return { dot: "bg-line", text: "text-subtle", label: "bekleniyor" };
}

function formatPct(value: number | null): string {
  return value === null ? "—" : `%${value.toFixed(value >= 99.95 ? 2 : 1)}`;
}

function formatAgo(ts: number | null): string {
  if (!ts) return "—";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (seconds < 60) return `${seconds} sn önce`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} dk önce`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} sa önce`;
  return `${Math.round(seconds / 86400)} gün önce`;
}

function describeWindow(window: MaintenanceWindow, monitors: MonitorView[]): string {
  const scope =
    window.monitorId === null
      ? "tüm servisler"
      : (monitors.find((m) => m.id === window.monitorId)?.name ?? "silinmiş servis");

  if (window.kind === "once") {
    const fmt = (ts: number | null) =>
      ts === null
        ? "?"
        : new Date(ts * 1000).toLocaleString("tr-TR", {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          });
    return `${fmt(window.startsAt)} – ${fmt(window.endsAt)} · ${scope}`;
  }

  const days = window.weekdays.map((d) => WEEKDAY_NAMES[d].slice(0, 3)).join(", ");
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
        setFormError((data.error as string) ?? "İşlem başarısız.");
        return null;
      }
      if (Array.isArray(data.monitors)) setMonitors(data.monitors as MonitorView[]);
      if (Array.isArray(data.windows)) setWindows(data.windows as MaintenanceWindow[]);
      return data;
    } catch {
      setFormError("Sunucuya ulaşılamadı.");
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
        ? `${monitor.name}: yanıt verdi (${result.latencyMs} ms)`
        : `${monitor.name}: ${result.error ?? "yanıt yok"}`,
    );
    setTimeout(() => setNotice(null), 5000);
  }

  const down = monitors.filter((m) => m.enabled && !m.inMaintenance && m.status === "down");
  const inMaintenance = monitors.filter((m) => m.inMaintenance);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <span className="font-medium">{monitors.length} servis</span>
          {down.length > 0 && (
            <span className="text-danger"> · {down.length} çevrimdışı</span>
          )}
          {inMaintenance.length > 0 && (
            <span className="text-brand"> · {inMaintenance.length} bakımda</span>
          )}
          {monitors.length > 0 && down.length === 0 && inMaintenance.length === 0 && (
            <span className="text-ok"> · hepsi çalışıyor</span>
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
            <Plus className="size-4" /> Servis ekle
          </button>
        )}
      </div>

      {notice && (
        <p className="rounded-md border border-line bg-surface px-4 py-2 text-sm">{notice}</p>
      )}

      {monitors.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-surface px-5 py-8 text-center text-sm text-subtle">
          Henüz izlenen servis yok. Home Assistant, Pi-hole ya da MQTT broker&apos;ı
          ekleyerek başlayabilirsin.
        </p>
      ) : (
        <div className="space-y-3">
          {monitors.map((monitor) => {
            const style = statusStyle(monitor);
            const typeLabel =
              MONITOR_TYPES.find((t) => t.value === monitor.type)?.label ?? monitor.type;

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
                      <span className={`text-xs ${style.text}`}>{style.label}</span>
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
                      <div className="text-subtle">24 saat</div>
                      <div className="font-medium">{formatPct(monitor.uptime24h)}</div>
                    </div>
                    <div className="text-right text-xs">
                      <div className="text-subtle">30 gün</div>
                      <div className="font-medium">{formatPct(monitor.uptime30d)}</div>
                    </div>
                    <div className="text-right text-xs">
                      <div className="text-subtle">yanıt</div>
                      <div className="font-medium">
                        {monitor.lastLatencyMs === null ? "—" : `${monitor.lastLatencyMs} ms`}
                      </div>
                    </div>

                    {canManage && (
                      <div className="flex items-center gap-1">
                        <IconButton
                          title="Şimdi kontrol et"
                          onClick={() => void checkNow(monitor)}
                          disabled={busy}
                        >
                          <Play className="size-3.5" />
                        </IconButton>
                        <IconButton
                          title="Düzenle"
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
                          title="Sil"
                          danger
                          onClick={() => {
                            if (confirm(`"${monitor.name}" silinsin mi?`)) {
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
                    <span>{monitor.days.length} gün önce</span>
                    <span>
                      son kontrol {formatAgo(monitor.lastCheckAt)} · her{" "}
                      {monitor.effective.intervalSeconds} sn
                    </span>
                    <span>bugün</span>
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
              <Wrench className="size-4" /> Bakım pencereleri
            </h2>
            <p className="mt-0.5 text-xs text-subtle">
              Pencere içindeyken kontrol sürer ama kesinti sayılmaz ve alarm üretilmez.
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
              <Plus className="size-3.5" /> Pencere ekle
            </button>
          )}
        </div>

        {windows.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-subtle">
            Tanımlı bakım penceresi yok.
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
                        şu an aktif
                      </span>
                    )}
                    {!window.enabled && (
                      <span className="rounded bg-line px-1.5 text-[10px] text-subtle">
                        kapalı
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-subtle">
                    {describeWindow(window, monitors)}
                  </p>
                </div>

                {canManage && (
                  <div className="flex items-center gap-1">
                    <IconButton
                      title="Düzenle"
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
                      title="Sil"
                      danger
                      onClick={() => {
                        if (confirm(`"${window.name}" silinsin mi?`)) {
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
        title={monitorModal.id === null ? "Servis ekle" : "Servisi düzenle"}
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
        title={windowModal.id === null ? "Bakım penceresi ekle" : "Bakım penceresini düzenle"}
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
