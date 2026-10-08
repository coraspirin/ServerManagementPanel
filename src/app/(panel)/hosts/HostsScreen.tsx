"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpCircle,
  Copy,
  HardDrive,
  KeyRound,
  Link2,
  Loader2,
  MonitorSmartphone,
  Plus,
  Power,
  Server,
  Trash2,
} from "lucide-react";
import { Modal } from "@/components/Modal";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import type { HostView } from "@/lib/hosts/view";
import { formatDateTime } from "@/lib/i18n/format";
import { useDict, useDynamicT, useT } from "@/lib/i18n/client";
import { copyText } from "@/lib/client/clipboard";
import type { UpdateStatus } from "@/lib/selfupdate";

type InstallKit = { token: string; image: string; port: number; env: string; compose: string };

const STATUS_STYLE: Record<HostView["status"], string> = {
  online: "bg-ok/15 text-ok",
  offline: "bg-danger/15 text-danger",
  incompatible: "bg-warn/15 text-warn",
  pending: "bg-warn/15 text-warn",
  unknown: "bg-line text-subtle",
};

const REFRESH_MS = 15_000;
const BTN = "rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50";
const BTN_SECONDARY =
  "flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand disabled:opacity-50";
const INPUT = "mt-1 w-full rounded-md border border-line bg-canvas px-3 py-2 outline-none focus:border-brand";
const ICON_BTN =
  "rounded border border-line p-1.5 text-subtle transition-colors hover:text-brand disabled:opacity-50";

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

async function call<T>(path: string, method: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const response = await fetch(path, {
    method,
    headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null);
  if (!response) return { ok: false, error: "network" };
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  return response.ok ? { ok: true, data } : { ok: false, error: data.error ?? `HTTP ${response.status}` };
}

type Dialog =
  | { kind: "add" }
  | { kind: "kit"; host: HostView; kit: InstallKit }
  | { kind: "enroll"; host: HostView }
  | { kind: "remove"; host: HostView }
  | { kind: "update"; host: HostView };

export function HostsScreen({
  initial,
  canManage,
  canUpdate,
}: {
  initial: HostView[];
  canManage: boolean;
  canUpdate: boolean;
}) {
  const t = useT();
  const tk = useDynamicT();
  const dict = useDict();
  const router = useRouter();
  const [hosts, setHosts] = useState(initial);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const reload = useCallback(async () => {
    const response = await fetch("/api/hosts", { cache: "no-store" }).catch(() => null);
    if (response?.ok) setHosts(((await response.json()) as { hosts: HostView[] }).hosts);
  }, []);

  // Heartbeat 15 sn'de bir yazıyor; liste aynı sıklıkta tazelenir.
  useEffect(() => {
    const timer = setInterval(reload, REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);

  function close() {
    setDialog(null);
    setError("");
    void reload();
    // Seçicideki liste layout'tan geliyor.
    router.refresh();
  }

  async function run<T>(action: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, then: (data: T) => void) {
    setBusy(true);
    setError("");
    const result = await action();
    setBusy(false);
    if (result.ok) then(result.data);
    else setError(result.error);
  }

  const outdated = hosts.filter((host) => host.enabled && host.pinned && host.updateTarget !== null);

  async function updateAll() {
    if (!window.confirm(t("hosts.update.allConfirm", { count: outdated.length }))) return;
    setBusy(true);
    setError("");
    setNotice("");
    const failures: string[] = [];
    for (const host of outdated) {
      const result = await call(`/api/hosts/${host.id}/update`, "POST");
      if (!result.ok) failures.push(`${host.name}: ${result.error}`);
    }
    setBusy(false);
    setError(failures.join("\n"));
    if (failures.length < outdated.length) setNotice(t("hosts.update.allStarted"));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-subtle">{t("hosts.screen.intro")}</p>
        <div className="flex flex-wrap gap-2">
          {canUpdate && outdated.length > 0 && (
            <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => void updateAll()}>
              <ArrowUpCircle className="size-4" aria-hidden />
              {t("hosts.update.all", { count: outdated.length })}
            </button>
          )}
          {canManage && (
            <button type="button" className={`${BTN} flex items-center gap-1.5`} onClick={() => setDialog({ kind: "add" })}>
              <Plus className="size-4" aria-hidden />
              {t("hosts.screen.add")}
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="rtable w-full min-w-[760px] text-sm">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-subtle">
            <tr>
              <th className="px-4 py-2.5 font-medium">{t("hosts.screen.colName")}</th>
              <th className="px-4 py-2.5 font-medium">{t("hosts.screen.colStatus")}</th>
              <th className="px-4 py-2.5 font-medium">{t("hosts.screen.colConnection")}</th>
              <th className="px-4 py-2.5 font-medium">{t("hosts.screen.colSystem")}</th>
              <th className="px-4 py-2.5 font-medium">{t("hosts.screen.colLastSeen")}</th>
              {(canManage || canUpdate) && <th className="px-4 py-2.5" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {hosts.map((host) => {
              const Icon =
                host.agentType === "local" ? Server : host.agentType === "mock" ? MonitorSmartphone : HardDrive;
              const remote = host.agentType === "agent";
              return (
                <tr key={host.id} className={host.enabled ? "" : "opacity-50"}>
                  <td data-label="" className="px-4 py-3">
                    <div className="flex items-center gap-2 font-medium">
                      <Icon className="size-4 shrink-0 text-subtle" aria-hidden />
                      {host.name}
                    </div>
                    <div className="text-xs text-subtle">{tk(`hosts.agentType.${host.agentType}`)}</div>
                    {host.lastError && host.status !== "online" && (
                      <div className="mt-1 max-w-xs break-words text-xs text-danger">{host.lastError}</div>
                    )}
                  </td>
                  <td data-label={t("hosts.screen.colStatus")} className="px-4 py-3">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLE[host.status]}`}>
                      {host.enabled ? tk(`hosts.status.${host.status}`) : t("hosts.screen.disabled")}
                    </span>
                    {host.latencyMs !== null && host.status === "online" && remote && (
                      <span className="ml-2 text-xs text-subtle">{host.latencyMs} ms</span>
                    )}
                  </td>
                  <td data-label={t("hosts.screen.colConnection")} className="px-4 py-3 font-mono text-xs text-subtle">
                    {host.agentUrl ?? "—"}
                    {host.agentVersion && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        v{host.agentVersion}
                        {host.updateTarget && (
                          <span className="rounded bg-warn/15 px-1.5 py-0.5 font-sans font-medium text-warn">
                            {t("hosts.update.badge", { version: host.updateTarget })}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td data-label={t("hosts.screen.colSystem")} className="px-4 py-3 text-xs text-subtle">
                    {host.hostname ?? "—"}
                    {host.osName && <div>{host.osName}</div>}
                  </td>
                  <td data-label={t("hosts.screen.colLastSeen")} className="px-4 py-3 text-xs text-subtle">
                    {remote && host.lastSeen ? formatDateTime(host.lastSeen * 1000, dict) : "—"}
                  </td>
                  {(canManage || canUpdate) && (
                    <td data-label="" className="px-4 py-3">
                      {remote && (
                        <div className="flex justify-end gap-1.5">
                          {canUpdate && host.pinned && (
                            <button
                              type="button"
                              title={t("hosts.update.button")}
                              aria-label={t("hosts.update.button")}
                              className={`${ICON_BTN} ${host.updateTarget ? "border-warn text-warn" : ""}`}
                              onClick={() => setDialog({ kind: "update", host })}
                            >
                              <ArrowUpCircle className="size-3.5" />
                            </button>
                          )}
                          {canManage && (
                            <>
                          <button
                            type="button"
                            title={t("hosts.screen.enroll")}
                            aria-label={t("hosts.screen.enroll")}
                            className={ICON_BTN}
                            onClick={() => setDialog({ kind: "enroll", host })}
                          >
                            <Link2 className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            title={t("hosts.screen.resetToken")}
                            aria-label={t("hosts.screen.resetToken")}
                            className={ICON_BTN}
                            disabled={busy}
                            onClick={() => {
                              if (!window.confirm(t("hosts.screen.resetTokenConfirm", { host: host.name }))) return;
                              void run(
                                () => call<{ kit: InstallKit }>(`/api/hosts/${host.id}/token`, "POST"),
                                ({ kit }) => setDialog({ kind: "kit", host, kit }),
                              );
                            }}
                          >
                            <KeyRound className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            title={host.enabled ? t("hosts.screen.disable") : t("hosts.screen.enable")}
                            aria-label={host.enabled ? t("hosts.screen.disable") : t("hosts.screen.enable")}
                            className={ICON_BTN}
                            disabled={busy}
                            onClick={() =>
                              void run(
                                () => call(`/api/hosts/${host.id}`, "PATCH", { enabled: !host.enabled }),
                                () => close(),
                              )
                            }
                          >
                            <Power className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            title={t("hosts.screen.remove")}
                            aria-label={t("hosts.screen.remove")}
                            className={`${ICON_BTN} hover:text-danger`}
                            onClick={() => setDialog({ kind: "remove", host })}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {error && !dialog && <p className="whitespace-pre-line text-sm text-danger">{error}</p>}
      {notice && !dialog && <p className="text-sm text-ok">{notice}</p>}

      {dialog?.kind === "add" && (
        <AddDialog
          busy={busy}
          error={error}
          onClose={close}
          onCreate={(name) =>
            run(
              () => call<{ host: HostView; kit: InstallKit }>("/api/hosts", "POST", { name }),
              ({ host, kit }) => {
                setError("");
                setDialog({ kind: "kit", host, kit });
              },
            )
          }
        />
      )}

      {dialog?.kind === "kit" && (
        <KitDialog
          host={dialog.host}
          kit={dialog.kit}
          busy={busy}
          error={error}
          onClose={close}
          onEnroll={(agentUrl) =>
            run(() => call(`/api/hosts/${dialog.host.id}/enroll`, "POST", { agentUrl }), () => close())
          }
        />
      )}

      {dialog?.kind === "enroll" && (
        <Modal open title={t("hosts.enroll.title", { host: dialog.host.name })} onClose={close}>
          <EnrollForm
            initialUrl={dialog.host.agentUrl ?? ""}
            busy={busy}
            error={error}
            onEnroll={(agentUrl) =>
              run(() => call(`/api/hosts/${dialog.host.id}/enroll`, "POST", { agentUrl }), () => close())
            }
          />
        </Modal>
      )}

      {dialog?.kind === "update" && <UpdateDialog host={dialog.host} onClose={close} />}

      {dialog?.kind === "remove" && (
        <RemoveDialog
          host={dialog.host}
          busy={busy}
          error={error}
          onClose={close}
          onRemove={() => run(() => call(`/api/hosts/${dialog.host.id}`, "DELETE"), () => close())}
        />
      )}
    </div>
  );
}

function AddDialog({
  busy,
  error,
  onClose,
  onCreate,
}: {
  busy: boolean;
  error: string;
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  return (
    <Modal open title={t("hosts.add.title")} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          onCreate(name);
        }}
      >
        <p className="text-sm text-subtle">{t("hosts.add.intro")}</p>
        <label className="block text-sm">
          <span className="text-subtle">{t("hosts.add.name")}</span>
          <input className={INPUT} value={name} onChange={(event) => setName(event.target.value)} autoFocus maxLength={40} />
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end">
          <button type="submit" className={BTN} disabled={busy || name.trim() === ""}>
            {t("hosts.add.create")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-subtle">
        <span>{label}</span>
        <button
          type="button"
          className="flex items-center gap-1 hover:text-ink"
          onClick={() => {
            void copyText(text).then(setCopied);
          }}
        >
          <Copy className="size-3" aria-hidden />
          {copied ? t("hosts.kit.copied") : t("hosts.kit.copy")}
        </button>
      </div>
      <pre className="mt-1 max-h-56 overflow-auto rounded-md border border-line bg-canvas p-3 font-mono text-xs">{text}</pre>
    </div>
  );
}

function KitDialog({
  host,
  kit,
  busy,
  error,
  onClose,
  onEnroll,
}: {
  host: HostView;
  kit: InstallKit;
  busy: boolean;
  error: string;
  onClose: () => void;
  onEnroll: (agentUrl: string) => void;
}) {
  const t = useT();
  return (
    <Modal open wide title={t("hosts.kit.title", { host: host.name })} onClose={onClose}>
      <div className="space-y-4">
        <p className="rounded-md bg-warn/10 px-3 py-2 text-sm text-warn">{t("hosts.kit.onceWarning")}</p>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-subtle">
          <li>{t("hosts.kit.step1")}</li>
          <li>{t("hosts.kit.step2")}</li>
          <li>{t("hosts.kit.step3", { port: kit.port })}</li>
        </ol>
        <CopyBlock label=".env" text={kit.env} />
        <CopyBlock label="docker-compose.yml" text={kit.compose} />
        <div className="border-t border-line pt-4">
          <EnrollForm initialUrl="" port={kit.port} busy={busy} error={error} onEnroll={onEnroll} />
        </div>
      </div>
    </Modal>
  );
}

function EnrollForm({
  initialUrl,
  port = 7443,
  busy,
  error,
  onEnroll,
}: {
  initialUrl: string;
  port?: number;
  busy: boolean;
  error: string;
  onEnroll: (agentUrl: string) => void;
}) {
  const t = useT();
  const [url, setUrl] = useState(initialUrl);
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        onEnroll(url);
      }}
    >
      <label className="block text-sm">
        <span className="text-subtle">{t("hosts.enroll.url")}</span>
        <input
          className={`${INPUT} font-mono`}
          value={url}
          placeholder={`https://192.168.1.20:${port}`}
          onChange={(event) => setUrl(event.target.value)}
        />
      </label>
      <p className="text-xs text-subtle">{t("hosts.enroll.hint")}</p>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end">
        <button type="submit" className={`${BTN_SECONDARY} border-brand`} disabled={busy || url.trim() === ""}>
          <Link2 className="size-4" aria-hidden />
          {busy ? t("hosts.enroll.connecting") : t("hosts.enroll.connect")}
        </button>
      </div>
    </form>
  );
}

function RemoveDialog({
  host,
  busy,
  error,
  onClose,
  onRemove,
}: {
  host: HostView;
  busy: boolean;
  error: string;
  onClose: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const [typed, setTyped] = useState("");
  return (
    <Modal open title={t("hosts.remove.title", { host: host.name })} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-subtle">{t("hosts.remove.body")}</p>
        <label className="block text-sm">
          <span className="text-subtle">{t("hosts.remove.typeName", { host: host.name })}</span>
          <input className={INPUT} value={typed} onChange={(event) => setTyped(event.target.value)} />
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end">
          <button
            type="button"
            className="rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            disabled={busy || typed !== host.name}
            onClick={onRemove}
          >
            {t("hosts.remove.confirm")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

const PHASE_STYLE: Record<UpdateStatus["phase"], string> = {
  idle: "bg-line text-subtle",
  running: "bg-brand/15 text-brand",
  done: "bg-ok/15 text-ok",
  failed: "bg-danger/15 text-danger",
  rolledBack: "bg-warn/15 text-warn",
};

type AgentUpdateInfo = {
  current: string | null;
  target: string | null;
  status: UpdateStatus | null;
  error: string | null;
};

const UPDATE_POLL_MS = 3_000;

/**
 * Ajan güncelleme penceresi: ajandaki updater'ın durumu ve günlüğü. Ajan
 * kendini yeniden yaratırken birkaç saniye ulaşılamaz — o sırada gelen hata
 * "yeniden başlıyor" olarak gösterilir, sorgu sürer.
 */
function UpdateDialog({ host, onClose }: { host: HostView; onClose: () => void }) {
  const t = useT();
  const tk = useDynamicT();
  const [info, setInfo] = useState<AgentUpdateInfo | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [manual, setManual] = useState("");
  const [watching, setWatching] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  const load = useCallback(async () => {
    const result = await call<AgentUpdateInfo>(`/api/hosts/${host.id}/update`, "GET");
    if (result.ok) setInfo(result.data);
  }, [host.id]);

  useEffect(() => {
    void call<AgentUpdateInfo>(`/api/hosts/${host.id}/update`, "GET").then((result) => {
      if (result.ok) setInfo(result.data);
    });
  }, [host.id]);

  const phase = info?.status?.phase;
  const running = phase === "running";

  useEffect(() => {
    if (!watching && !running) return;
    const timer = setInterval(() => void load(), UPDATE_POLL_MS);
    return () => clearInterval(timer);
  }, [watching, running, load]);

  // Updater bu sürüm için sonucu yazınca (ajan yeni sürümle açıldıysa yeni
  // ajan okur) izleme biter. Önceki bir güncellemenin "tamamlandı" durumu sayılmaz.
  const finished =
    watching && phase !== undefined && phase !== "running" && phase !== "idle" && info?.status?.tag === info?.target;
  if (finished) setWatching(false);

  const logLength = info?.status?.log.length ?? 0;
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [logLength]);

  async function start() {
    setStarting(true);
    setStartError("");
    setManual("");
    const response = await fetch(`/api/hosts/${host.id}/update`, {
      method: "POST",
      headers: { [CSRF_HEADER]: readCsrfToken() },
    }).catch(() => null);
    setStarting(false);
    if (!response) {
      setStartError("network");
      return;
    }
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string; manual?: string };
      setStartError(data.error ?? `HTTP ${response.status}`);
      setManual(data.manual ?? "");
      return;
    }
    setWatching(true);
    void load();
  }

  const status = info?.status ?? null;
  const target = info ? info.target : host.updateTarget;
  const current = `v${(info ? info.current : host.agentVersion) ?? "?"}`;

  return (
    <Modal open wide title={t("hosts.update.title", { host: host.name })} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm">
          {target ? t("hosts.update.available", { current, target }) : t("hosts.update.upToDate", { current })}
        </p>
        <p className="text-xs text-subtle">{t("hosts.update.intro")}</p>

        {target && (
          <div className="flex justify-end">
            <button
              type="button"
              className={`${BTN} flex items-center gap-1.5`}
              disabled={starting || running || watching}
              onClick={() => void start()}
            >
              {starting || running || watching ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <ArrowUpCircle className="size-4" aria-hidden />
              )}
              {t("hosts.update.start", { target })}
            </button>
          </div>
        )}

        {startError && <p className="text-sm text-danger">{startError}</p>}
        {manual && <CopyBlock label={t("hosts.update.manual")} text={manual} />}

        {status && status.phase !== "idle" && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${PHASE_STYLE[status.phase]}`}>
                {tk(`update.phase.${status.phase}`)}
                {status.tag ? ` · ${status.tag}` : ""}
              </span>
              {status.detail && status.phase !== "done" && (
                <span className="text-xs text-subtle">{t("update.detail", { detail: status.detail })}</span>
              )}
            </div>
            {status.log.length > 0 && (
              <pre
                ref={logRef}
                className="thin-scrollbar max-h-64 overflow-auto rounded-md border border-line bg-canvas p-3 font-mono text-xs leading-5"
              >
                {status.log.join("\n")}
              </pre>
            )}
          </div>
        )}
        {info?.error && (watching || running ? (
          <p className="text-sm text-warn">{t("hosts.update.restarting")}</p>
        ) : (
          <p className="text-sm text-subtle">{info.error}</p>
        ))}
      </div>
    </Modal>
  );
}
