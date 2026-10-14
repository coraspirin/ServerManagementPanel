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
import { HintBox } from "@/components/permissions/HintBox";
import type { FeatureState } from "@/lib/permissions/catalog";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import type { HostView } from "@/lib/hosts/view";
import { formatDateTime } from "@/lib/i18n/format";
import { useDict, useDynamicT, useT, useTimeZone } from "@/lib/i18n/client";
import { copyText } from "@/lib/client/clipboard";
import type { UpdateStatus } from "@/lib/selfupdate";

type InstallKit = { token: string; image: string; port: number; env: string; compose: string; native: string };

const STATUS_STYLE: Record<HostView["status"], string> = {
  online: "bg-ok/15 text-ok",
  offline: "bg-danger/15 text-danger",
  incompatible: "bg-warn/15 text-warn",
  pending: "bg-warn/15 text-warn",
  unknown: "bg-line text-subtle",
};

const REFRESH_MS = 15_000;
/** Kurulum penceresi açıkken ajanın duyurusu daha sık yoklanır. */
const ANNOUNCE_REFRESH_MS = 3_000;
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
  | { kind: "update"; host: HostView }
  | { kind: "features"; host: HostView };

export function HostsScreen({
  initial,
  canManage,
  canUpdate,
  openAdd = false,
}: {
  initial: HostView[];
  canManage: boolean;
  canUpdate: boolean;
  /** `/hosts?ekle=1` — "İlk sunucunu ekle" ekranından gelindi. */
  openAdd?: boolean;
}) {
  const t = useT();
  const tk = useDynamicT();
  const dict = useDict();
  const timeZone = useTimeZone();
  const router = useRouter();
  const [hosts, setHosts] = useState(initial);
  const [dialog, setDialog] = useState<Dialog | null>(openAdd && canManage ? { kind: "add" } : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const reload = useCallback(async () => {
    const response = await fetch("/api/hosts", { cache: "no-store" }).catch(() => null);
    if (response?.ok) setHosts(((await response.json()) as { hosts: HostView[] }).hosts);
  }, []);

  // Heartbeat 15 sn'de bir yazıyor; liste aynı sıklıkta tazelenir.
  const waitingAnnounce = dialog?.kind === "kit";
  useEffect(() => {
    const timer = setInterval(reload, waitingAnnounce ? ANNOUNCE_REFRESH_MS : REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload, waitingAnnounce]);

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
                    <FeatureSummary host={host} onOpen={() => setDialog({ kind: "features", host })} />
                    {canManage && host.announce && (
                      <button
                        type="button"
                        className="mt-1 flex items-center gap-1 rounded bg-ok/15 px-1.5 py-0.5 text-xs font-medium text-ok"
                        onClick={() => setDialog({ kind: "enroll", host })}
                      >
                        <Link2 className="size-3" aria-hidden />
                        {t("hosts.announce.found", { url: host.announce.url })}
                      </button>
                    )}
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
                        {host.capabilities.native && (
                          <span className="rounded bg-brand/15 px-1.5 py-0.5 font-sans font-medium text-brand" title={t("hosts.native.help")}>
                            {t("hosts.native.badge")}
                          </span>
                        )}
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
                    {remote && host.lastSeen ? formatDateTime(host.lastSeen * 1000, dict, undefined, timeZone) : "—"}
                  </td>
                  {(canManage || canUpdate) && (
                    <td data-label="" className="px-4 py-3">
                      {/* Yerel sunucu isteğe bağlı (D1): yalnızca açılıp kapatılabilir. */}
                      {canManage && host.agentType === "local" && (
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            title={host.enabled ? t("hosts.screen.disable") : t("hosts.screen.enable")}
                            aria-label={host.enabled ? t("hosts.screen.disable") : t("hosts.screen.enable")}
                            className={ICON_BTN}
                            disabled={busy}
                            onClick={() => {
                              if (host.enabled && !window.confirm(t("hosts.screen.disableLocalConfirm"))) return;
                              void run(
                                () => call(`/api/hosts/${host.id}`, "PATCH", { enabled: !host.enabled }),
                                () => close(),
                              );
                            }}
                          >
                            <Power className="size-3.5" />
                          </button>
                        </div>
                      )}
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
          announce={hosts.find((item) => item.id === dialog.host.id)?.announce ?? null}
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
          {dialog.host.announce && <AnnounceInfo announce={dialog.host.announce} />}
          <EnrollForm
            initialUrl={dialog.host.announce?.url ?? dialog.host.agentUrl ?? ""}
            busy={busy}
            error={error}
            onEnroll={(agentUrl) =>
              run(() => call(`/api/hosts/${dialog.host.id}/enroll`, "POST", { agentUrl }), () => close())
            }
          />
        </Modal>
      )}

      {dialog?.kind === "update" && <UpdateDialog host={dialog.host} onClose={close} />}

      {dialog?.kind === "features" && (
        <FeaturesDialog host={hosts.find((item) => item.id === dialog.host.id) ?? dialog.host} onClose={close} />
      )}

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

/** Ajanın duyurusu: adres, sistem, parmak izi (kurulum çıktısıyla karşılaştırmak için). */
function AnnounceInfo({ announce }: { announce: NonNullable<HostView["announce"]> }) {
  const t = useT();
  return (
    <div className="mb-3 space-y-1 rounded-md border border-ok/40 bg-ok/10 px-3 py-2 text-sm">
      <div className="font-medium text-ok">{t("hosts.announce.found", { url: announce.url })}</div>
      <div className="text-xs text-subtle">
        {t("hosts.announce.details", { hostname: announce.hostname, version: announce.version })}
        {announce.osName && ` · ${announce.osName}`}
      </div>
      <div className="text-xs text-subtle">{t("hosts.announce.fingerprint")}</div>
      <div className="break-all font-mono text-xs">{announce.fingerprint}</div>
    </div>
  );
}

function KitDialog({
  host,
  announce,
  kit,
  busy,
  error,
  onClose,
  onEnroll,
}: {
  host: HostView;
  announce: HostView["announce"];
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
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{t("hosts.kit.nativeTitle")}</h3>
          <p className="text-sm text-subtle">{t("hosts.kit.nativeHelp", { port: kit.port })}</p>
          <CopyBlock label="bash" text={kit.native} />
        </section>
        <details className="rounded-md border border-line px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">{t("hosts.kit.dockerTitle")}</summary>
          <div className="mt-3 space-y-3">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-subtle">
              <li>{t("hosts.kit.step1")}</li>
              <li>{t("hosts.kit.step2")}</li>
              <li>{t("hosts.kit.step3", { port: kit.port })}</li>
            </ol>
            <CopyBlock label=".env" text={kit.env} />
            <CopyBlock label="docker-compose.yml" text={kit.compose} />
          </div>
        </details>
        <div className="border-t border-line pt-4">
          {announce ? (
            <AnnounceInfo announce={announce} />
          ) : (
            <p className="mb-3 flex items-center gap-2 text-sm text-subtle">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t("hosts.announce.waiting")}
            </p>
          )}
          {/* Duyuru gelince form o adresle yeniden kurulur. */}
          <EnrollForm
            key={announce?.url ?? ""}
            initialUrl={announce?.url ?? ""}
            port={kit.port}
            busy={busy}
            error={error}
            submitLabel={announce ? t("hosts.announce.approve") : undefined}
            onEnroll={onEnroll}
          />
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
  submitLabel,
  onEnroll,
}: {
  initialUrl: string;
  port?: number;
  submitLabel?: string;
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
          {busy ? t("hosts.enroll.connecting") : (submitLabel ?? t("hosts.enroll.connect"))}
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

const STATE_STYLE: Record<FeatureState, string> = {
  ok: "bg-ok/15 text-ok",
  partial: "bg-warn/15 text-warn",
  off: "bg-danger/15 text-danger",
};

const STATE_MARK: Record<FeatureState, string> = { ok: "✅", partial: "🟡", off: "🔴" }; // i18n-ignore — simge

/** Satırdaki kısa yoklama özeti: ✅ n · 🟡 n · 🔴 n (kararlar.md D6). */
function FeatureSummary({ host, onOpen }: { host: HostView; onOpen: () => void }) {
  const t = useT();
  if (!host.features) return null;
  const count = (state: FeatureState) => host.features?.filter((item) => item.state === state).length ?? 0;
  return (
    <button type="button" onClick={onOpen} className="mt-1 text-xs text-subtle hover:text-brand">
      {t("hosts.features.show")}: {(["ok", "partial", "off"] as const).map((state) => `${STATE_MARK[state]} ${count(state)}`).join(" · ")}
    </button>
  );
}

function FeaturesDialog({ host, onClose }: { host: HostView; onClose: () => void }) {
  const t = useT();
  const tk = useDynamicT();
  return (
    <Modal open title={t("hosts.features.title", { host: host.name })} onClose={onClose} wide>
      <p className="text-sm text-subtle">{t("hosts.features.intro")}</p>
      {!host.features ? (
        <p className="mt-3 text-sm">{t("hosts.features.pending")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {host.features.map((feature) => (
            <li key={feature.key} className="py-2.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span>{tk(`permissions.feature.${feature.key}`)}</span>
                <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATE_STYLE[feature.state]}`}>
                  {STATE_MARK[feature.state]} {tk(`permissions.state.${feature.state}`)}
                </span>
              </div>
              {feature.hints.length > 0 && (
                <div className="mt-2 space-y-2">
                  {feature.hints.map((hint) => (
                    <HintBox key={hint.code} hint={hint} compact />
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
