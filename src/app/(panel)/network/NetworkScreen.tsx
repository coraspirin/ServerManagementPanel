"use client";

import { useState } from "react";
import { Check, Plus, Power, RadioTower, Trash2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import type { Device } from "@/lib/network/scan";
import type { WolDevice } from "@/lib/network/wol";
import { useFormat, useT } from "@/lib/i18n/client";
import { Rich } from "@/lib/i18n/rich";

/**
 * M2.9 + M2.11 — Ağ ekranı.
 *
 * Cihaz envanteri ve Wake-on-LAN aynı ekranda: WoL kaydı neredeyse her zaman
 * envanterde görülen bir cihazdan doğuyor ve "keşiften tek tık" akışı ancak
 * ikisi yan yanayken mümkün.
 */

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

const inputClass =
  "w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand";

type WolForm = {
  id: number | null;
  name: string;
  mac: string;
  broadcast: string;
  port: string;
  checkHost: string;
};

const EMPTY_WOL: WolForm = {
  id: null,
  name: "",
  mac: "",
  broadcast: "",
  port: "9",
  checkHost: "",
};

type OuiStatus = { present: boolean; ageDays: number | null; entries: number };

export function NetworkScreen({
  initialDevices,
  initialWol,
  subnet,
  oui: initialOui,
}: {
  initialDevices: Device[];
  initialWol: WolDevice[];
  subnet: string;
  oui: OuiStatus;
}) {
  const t = useT();
  const f = useFormat();
  const [devices, setDevices] = useState(initialDevices);
  const [wol, setWol] = useState(initialWol);
  const [oui, setOui] = useState(initialOui);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [wolModal, setWolModal] = useState<{ open: boolean; form: WolForm }>({
    open: false,
    form: EMPTY_WOL,
  });

  async function send(
    url: string,
    method: string,
    body?: unknown,
  ): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = (await response.json()) as Record<string, unknown>;

      if (!response.ok) {
        setError((data.error as string) ?? t("common.errors.actionFailed"));
        return null;
      }
      if (Array.isArray(data.devices)) setDevices(data.devices as Device[]);
      if (Array.isArray(data.wol)) setWol(data.wol as WolDevice[]);
      if (data.oui) setOui(data.oui as OuiStatus);
      if (typeof data.message === "string") setNotice(data.message);
      return data;
    } catch {
      setError(t("common.errors.network"));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function scan() {
    setNotice(t("networkScreen.scanning"));
    const data = await send("/api/network", "POST", { action: "scan" });
    const result = data?.result as
      | { subnet: string; scanned: number; alive: number; newDevices: Device[] }
      | undefined;

    setNotice(
      result
        ? result.subnet
          ? t("networkScreen.scanResult", {
              subnet: result.subnet,
              alive: result.alive,
              count: result.newDevices.length,
            })
          : t("networkScreen.noSubnet")
        : null,
    );
  }

  const unknown = devices.filter((device) => !device.known);

  return (
    <div className="space-y-6">
      {notice && (
        <p className="flex items-start justify-between gap-3 rounded-md border border-line bg-surface px-4 py-2 text-sm">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="shrink-0 text-xs text-subtle hover:text-ink"
          >
            {t("proxy.dismiss")}
          </button>
        </p>
      )}
      {error && (
        <p className="rounded-md border border-danger/40 bg-surface px-4 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <section className="rounded-lg border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">
            {t("networkScreen.devices")} <span className="font-normal text-subtle">{devices.length}</span>
            {unknown.length > 0 && (
              <span className="ml-2 font-normal text-warn">
                {t("networkScreen.unknownCount", { count: unknown.length })}
              </span>
            )}
          </h2>
          <button
            type="button"
            onClick={() => void scan()}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            <RadioTower className="size-4" /> {t("networkScreen.scanNow")}
          </button>
        </div>

        <p className="mt-1 text-xs text-subtle">
          {subnet ? t("networkScreen.subnet", { subnet }) : t("networkScreen.subnetMissing")}
          {" · "}
          {t("networkScreen.vendorList")}{" "}
          {oui.present ? (
            t("networkScreen.vendorEntries", { count: oui.entries }) +
            (oui.ageDays !== null ? t("networkScreen.vendorAge", { count: oui.ageDays }) : "")
          ) : (
            <button
              type="button"
              onClick={() => void send("/api/network", "POST", { action: "oui" })}
              className="text-brand hover:underline"
            >
              {t("networkScreen.download")}
            </button>
          )}
        </p>

        {devices.length === 0 ? (
          <p className="mt-4 text-sm text-subtle">
            {t("networkScreen.noDevices")}
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-line rounded-md border border-line">
            {devices.map((device) => (
              <li key={device.mac} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <span
                  aria-hidden
                  title={device.online ? t("networkScreen.online") : t("networkScreen.offline")}
                  className={`size-2 shrink-0 rounded-full ${device.online ? "bg-ok" : "bg-line"}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {device.label || device.hostname || device.ip}
                    </span>
                    {!device.known && (
                      <span className="rounded bg-warn/15 px-1 text-[10px] font-medium text-warn">
                        {t("networkScreen.unknown")}
                      </span>
                    )}
                  </span>
                  <span className="block truncate font-mono text-[11px] text-subtle">
                    {device.ip} · {device.mac}
                    {device.vendor && ` · ${device.vendor}`}
                  </span>
                  <span className="block text-[11px] text-subtle">
                    {t("networkScreen.lastSeen", { when: f.relative(device.lastSeen * 1000) })}
                  </span>
                </span>

                {!device.known && (
                  <button
                    type="button"
                    onClick={() =>
                      void send("/api/network", "POST", {
                        action: "known",
                        mac: device.mac,
                        known: true,
                        label: device.label,
                      })
                    }
                    className="flex items-center gap-1 rounded border border-line px-2 py-1 text-[11px] hover:border-brand"
                  >
                    <Check className="size-3" /> {t("networkScreen.markKnown")}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() =>
                    setWolModal({
                      open: true,
                      form: {
                        ...EMPTY_WOL,
                        name: device.label || device.hostname || device.ip,
                        mac: device.mac,
                        checkHost: device.ip,
                      },
                    })
                  }
                  title={t("networkScreen.createWol")}
                  className="flex items-center gap-1 rounded border border-line px-2 py-1 text-[11px] hover:border-brand"
                >
                  <Power className="size-3" /> WoL
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    if (!confirm(t("networkScreen.confirmDeleteDevice", { mac: device.mac }))) return;
                    await send(`/api/network?mac=${encodeURIComponent(device.mac)}`, "DELETE");
                  }}
                  aria-label={t("proxy.deleteAria", { name: device.mac })}
                  className="rounded p-1 text-subtle hover:text-danger"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">
            Wake-on-LAN <span className="font-normal text-subtle">{wol.length}</span>
          </h2>
          <button
            type="button"
            onClick={() => setWolModal({ open: true, form: EMPTY_WOL })}
            className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm hover:border-brand"
          >
            <Plus className="size-4" /> {t("networkScreen.addDevice")}
          </button>
        </div>

        <p className="mt-1 text-xs text-subtle">
          <Rich
            text={t("networkScreen.wolNote")}
            values={{ strong: <strong>{t("networkScreen.wolNoteStrong")}</strong> }}
          />
        </p>

        {wol.length === 0 ? (
          <p className="mt-4 text-sm text-subtle">{t("networkScreen.empty")}</p>
        ) : (
          <ul className="mt-4 divide-y divide-line rounded-md border border-line">
            {wol.map((device) => (
              <li key={device.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{device.name}</span>
                  <span className="block truncate font-mono text-[11px] text-subtle">
                    {device.mac} → {device.broadcast || "255.255.255.255"}:{device.port}
                    {device.lastSentAt &&
                      t("networkScreen.lastSent", { when: f.dateTime(device.lastSentAt * 1000) })}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void send("/api/network/wol", "POST", { action: "wake", id: device.id })}
                  className="flex items-center gap-1.5 rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
                >
                  <Power className="size-3.5" /> {t("networkScreen.wake")}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!confirm(t("networkScreen.confirmDelete", { name: device.name }))) return;
                    await send(`/api/network/wol?id=${device.id}`, "DELETE");
                  }}
                  aria-label={t("proxy.deleteAria", { name: device.name })}
                  className="rounded p-1 text-subtle hover:text-danger"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Modal
        open={wolModal.open}
        title={wolModal.form.id === null ? t("networkScreen.modalAdd") : t("networkScreen.modalEdit")}
        onClose={() => setWolModal((m) => ({ ...m, open: false }))}
      >
        <form
          className="space-y-3 px-5 py-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = wolModal.form;
            const result = await send("/api/network/wol", "POST", {
              ...form,
              port: Number(form.port),
            });
            if (result) setWolModal({ open: false, form: EMPTY_WOL });
          }}
        >
          <label className="block">
            <span className="text-xs font-medium">{t("users.roles.name")}</span>
            <input
              type="text"
              value={wolModal.form.name}
              onChange={(e) =>
                setWolModal((m) => ({ ...m, form: { ...m.form, name: e.target.value } }))
              }
              autoFocus
              className={`mt-1 ${inputClass}`}
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium">{t("networkScreen.mac")}</span>
            <input
              type="text"
              value={wolModal.form.mac}
              onChange={(e) =>
                setWolModal((m) => ({ ...m, form: { ...m.form, mac: e.target.value } }))
              }
              placeholder="aa:bb:cc:dd:ee:ff"
              className={`mt-1 font-mono ${inputClass}`}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium">{t("networkScreen.broadcast")}</span>
              <input
                type="text"
                value={wolModal.form.broadcast}
                onChange={(e) =>
                  setWolModal((m) => ({ ...m, form: { ...m.form, broadcast: e.target.value } }))
                }
                placeholder="192.168.61.255"
                className={`mt-1 font-mono ${inputClass}`}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium">{t("proxy.form.port")}</span>
              <input
                type="number"
                value={wolModal.form.port}
                onChange={(e) =>
                  setWolModal((m) => ({ ...m, form: { ...m.form, port: e.target.value } }))
                }
                className={`mt-1 ${inputClass}`}
              />
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-medium">{t("networkScreen.checkHost")}</span>
            <input
              type="text"
              value={wolModal.form.checkHost}
              onChange={(e) =>
                setWolModal((m) => ({ ...m, form: { ...m.form, checkHost: e.target.value } }))
              }
              placeholder="192.168.61.50"
              className={`mt-1 font-mono ${inputClass}`}
            />
            <span className="mt-1 block text-[11px] text-subtle">
              {t("networkScreen.checkHostHelp")}
            </span>
          </label>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setWolModal((m) => ({ ...m, open: false }))}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-subtle hover:text-ink"
            >
              {t("common.actions.cancel")}
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? t("common.states.saving") : t("common.actions.save")}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
