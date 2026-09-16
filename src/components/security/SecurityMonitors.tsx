"use client";

import { useCallback, useState } from "react";
import {
  AlertTriangle,
  Ban,
  Bug,
  Check,
  KeyRound,
  RotateCw,
  Router,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import type { Fail2banState, FailedLogin } from "@/lib/security/fail2ban";
import type { SshAudit } from "@/lib/security/sshkeys";
import type { PortForward } from "@/lib/security/upnp";
import type { ScanRow } from "@/lib/security/vuln";
import { useFormat, useT } from "@/lib/i18n/client";
import { Rich } from "@/lib/i18n/rich";

/** M3.8 — güvenlik izleme panelleri. Her biri kendi verisini kendi çekiyor. */

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

async function api(body: Record<string, unknown>) {
  const response = await fetch("/api/security/monitor", {
    method: "POST",
    headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
    body: JSON.stringify(body),
  });
  return { response, data: (await response.json()) as Record<string, unknown> };
}


/* ---------------- CVE taraması ---------------- */

export function VulnPanel({
  initial,
  canManage,
}: {
  initial: ScanRow[];
  canManage: boolean;
}) {
  const t = useT();
  const f = useFormat();
  const [scans, setScans] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  async function scan() {
    setBusy(true);
    setNotice(t("secmon.vuln.scanning"));
    const { data } = await api({ action: "scan-vuln" });
    setNotice(String(data.message ?? t("logsScreen.done")));
    if (data.scans) setScans(data.scans as ScanRow[]);
    setBusy(false);
  }

  const totalCritical = scans.reduce((sum, scan) => sum + scan.critical, 0);

  return (
    <section className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Bug className="size-4 text-subtle" aria-hidden />
          {t("secmon.vuln.title")}
          {scans.length > 0 && (
            <span className={`font-normal ${totalCritical > 0 ? "text-danger" : "text-ok"}`}>
              {t("secmon.vuln.critical", { count: totalCritical })}
            </span>
          )}
        </h2>
        {canManage && (
          <button
            type="button"
            onClick={() => void scan()}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand disabled:opacity-50"
          >
            <RotateCw className={`size-4 ${busy ? "animate-spin" : ""}`} />{" "}
            {t("networkScreen.scanNow")}
          </button>
        )}
      </div>

      {notice && <p className="border-b border-line px-5 py-2 text-xs text-subtle">{notice}</p>}

      <p className="border-b border-line bg-brand/5 px-5 py-2 text-xs text-subtle">
        <Rich
          text={t("secmon.vuln.intro")}
          values={{ strong: <strong>{t("secmon.vuln.fixable")}</strong> }}
        />
      </p>

      {scans.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-subtle">
          {t("secmon.vuln.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {scans.map((scan) => (
            <li key={scan.image}>
              <button
                type="button"
                onClick={() => setOpen(open === scan.image ? null : scan.image)}
                className="flex w-full flex-wrap items-center gap-3 px-5 py-2.5 text-left hover:bg-line/30"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{scan.image}</span>
                {scan.ok ? (
                  <span className="flex gap-2 text-xs">
                    {scan.critical > 0 && (
                      <span className="rounded bg-danger/15 px-1.5 py-0.5 font-medium text-danger">
                        {t("secmon.vuln.critical", { count: scan.critical })}
                      </span>
                    )}
                    {scan.high > 0 && (
                      <span className="rounded bg-warn/15 px-1.5 py-0.5 font-medium text-warn">
                        {t("secmon.vuln.high", { count: scan.high })}
                      </span>
                    )}
                    {scan.medium > 0 && (
                      <span className="rounded bg-line px-1.5 py-0.5 text-subtle">
                        {t("secmon.vuln.medium", { count: scan.medium })}
                      </span>
                    )}
                    {scan.critical + scan.high + scan.medium === 0 && (
                      <span className="text-ok">{t("secmon.vuln.clean")}</span>
                    )}
                  </span>
                ) : (
                  <span className="text-xs text-danger">{scan.error.slice(0, 80)}</span>
                )}
                <span className="shrink-0 text-[11px] text-subtle">{f.dateTime(scan.ts * 1000)}</span>
              </button>

              {open === scan.image && scan.findings.length > 0 && (
                <div className="overflow-x-auto border-t border-line bg-canvas/50 px-5 py-2">
                  <table className="rtable w-full text-[11px]">
                    <thead className="text-left text-subtle">
                      <tr>
                        <th className="py-1 pr-3 font-medium">CVE</th>
                        <th className="py-1 pr-3 font-medium">{t("secmon.vuln.col.severity")}</th>
                        <th className="py-1 pr-3 font-medium">{t("secmon.vuln.col.package")}</th>
                        <th className="py-1 pr-3 font-medium">{t("secmon.vuln.col.installed")}</th>
                        <th className="py-1 pr-3 font-medium">{t("secmon.vuln.col.fixed")}</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      {scan.findings.slice(0, 40).map((finding) => (
                        <tr key={finding.id + finding.package}>
                          <td data-label="" className="py-0.5 pr-3">{finding.id}</td>
                          <td
                            data-label={t("secmon.vuln.col.severity")}
                            className={`py-0.5 pr-3 ${
                              finding.severity === "CRITICAL" ? "text-danger" : "text-warn"
                            }`}
                          >
                            {finding.severity}
                          </td>
                          <td data-label={t("secmon.vuln.col.package")} className="py-0.5 pr-3">{finding.package}</td>
                          <td data-label={t("secmon.vuln.col.installed")} className="py-0.5 pr-3">{finding.installed}</td>
                          <td data-label={t("secmon.vuln.col.fixed")} className="py-0.5 pr-3 text-ok">{finding.fixed}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------------- fail2ban + başarısız girişler ---------------- */

export function IntrusionPanel({
  initialFailed,
  canManage,
}: {
  initialFailed: FailedLogin[];
  canManage: boolean;
}) {
  const t = useT();
  const f = useFormat();
  const [state, setState] = useState<Fail2banState | null>(null);
  const [failed, setFailed] = useState(initialFailed);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/security/monitor?mode=fail2ban", { cache: "no-store" });
      const data = (await response.json()) as {
        fail2ban: Fail2banState;
        failedLogins: FailedLogin[];
      };
      setState(data.fail2ban);
      setFailed(data.failedLogins);
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <section className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Ban className="size-4 text-subtle" aria-hidden />
          {t("secmon.bans.title")}
          {state && <span className="font-normal text-subtle">{state.message}</span>}
        </h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand disabled:opacity-50"
        >
          <RotateCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
          {state ? t("common.actions.refresh") : t("secmon.bans.read")}
        </button>
      </div>

      {state?.setupHint && (
        <div className="border-b border-line bg-warn/5 px-5 py-3">
          <p className="text-xs text-warn">{state.message}</p>
          <code className="mt-1 block select-all whitespace-pre-wrap rounded bg-canvas px-2 py-1.5 font-mono text-[11px]">
            {state.setupHint}
          </code>
        </div>
      )}

      {state?.available && (
        <ul className="divide-y divide-line">
          {state.jails.map((jail) => (
            <li key={jail.name} className="px-5 py-2.5">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-medium">{jail.name}</span>
                <span className="text-xs text-subtle">
                  {t("secmon.bans.jail", {
                    current: jail.currentlyBanned,
                    total: jail.totalBanned,
                    failed: jail.totalFailed,
                  })}
                </span>
              </div>
              {jail.bannedIps.length > 0 && (
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {jail.bannedIps.map((ip) => (
                    <li
                      key={ip}
                      className="flex items-center gap-1 rounded border border-line px-1.5 py-0.5 font-mono text-[11px]"
                    >
                      {ip}
                      {canManage && (
                        <button
                          type="button"
                          title={t("secmon.bans.unban")}
                          onClick={async () => {
                            if (confirm(t("secmon.bans.confirmUnban", { ip, jail: jail.name }))) {
                              const { data } = await api({ action: "unban", jail: jail.name, ip });
                              if (data.fail2ban) setState(data.fail2ban as Fail2banState);
                            }
                          }}
                          className="text-subtle transition-colors hover:text-brand"
                        >
                          <Check className="size-3" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-line px-5 py-3">
        <h3 className="text-xs font-semibold text-subtle">
          {t("secmon.bans.panelLogins")}
        </h3>
        <p className="mt-0.5 text-[11px] text-subtle">
          {t("secmon.bans.panelNote")}
        </p>
        {failed.length === 0 ? (
          <p className="mt-2 text-sm text-ok">{t("secmon.bans.noFailed")}</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {failed.map((entry) => (
              <li key={`${entry.username}-${entry.ip}`} className="flex flex-wrap gap-3 text-xs">
                <span className="w-32 truncate font-mono">{entry.username || t("secmon.bans.emptyUser")}</span>
                <span className="w-32 font-mono text-subtle">{entry.ip || "—"}</span>
                <span className={entry.attempts >= 5 ? "text-warn" : "text-subtle"}>
                  {t("secmon.bans.attempts", { count: entry.attempts })}
                </span>
                <span className="text-subtle">{f.dateTime(entry.lastAt * 1000)}</span>
                <span className="min-w-0 flex-1 truncate text-subtle">{entry.lastDetail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/* ---------------- SSH anahtar denetimi ---------------- */

export function SshPanel() {
  const t = useT();
  const [audit, setAudit] = useState<SshAudit | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const response = await fetch("/api/security/monitor?mode=ssh", { cache: "no-store" });
      const data = (await response.json()) as { ssh: SshAudit };
      setAudit(data.ssh);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <KeyRound className="size-4 text-subtle" aria-hidden />
          {t("secmon.ssh.title")}
          {audit && (
            <span className="font-normal text-subtle">
              {t("secmon.ssh.keys", { count: audit.keys.length })}
            </span>
          )}
        </h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand disabled:opacity-50"
        >
          <RotateCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
          {audit ? t("common.actions.refresh") : t("secmon.ssh.audit")}
        </button>
      </div>

      {audit === null ? (
        <p className="px-5 py-8 text-center text-sm text-subtle">
          {t("secmon.ssh.intro")}
        </p>
      ) : audit.error ? (
        <p className="px-5 py-6 text-sm text-danger">{audit.error}</p>
      ) : (
        <>
          <div className="border-b border-line px-5 py-2.5 text-xs">
            <span className="text-subtle">sshd: </span>
            {t("secmon.ssh.passwordLogin")}{" "}
            <strong
              className={
                audit.sshd.passwordAuthentication?.toLowerCase() === "yes" ? "text-warn" : "text-ok"
              }
            >
              {audit.sshd.passwordAuthentication ?? t("secmon.ssh.default")}
            </strong>
            {" · "}
            {t("secmon.ssh.rootLogin")}{" "}
            <strong>{audit.sshd.permitRootLogin ?? t("secmon.ssh.default")}</strong>
            {audit.sshd.port && t("secmon.ssh.port", { port: audit.sshd.port })}
          </div>

          {audit.notes.length > 0 && (
            <ul className="border-b border-line bg-warn/5 px-5 py-2">
              {audit.notes.map((note) => (
                <li key={note} className="flex items-start gap-1.5 text-xs text-warn">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                  {note}
                </li>
              ))}
            </ul>
          )}

          <div className="overflow-x-auto">
            <table className="rtable w-full min-w-[40rem] text-xs">
              <thead className="border-b border-line text-left text-subtle">
                <tr>
                  <th className="px-5 py-2 font-medium">{t("secmon.ssh.col.account")}</th>
                  <th className="px-4 py-2 font-medium">{t("secmon.ssh.col.type")}</th>
                  <th className="px-4 py-2 font-medium">{t("secmon.ssh.col.fingerprint")}</th>
                  <th className="px-4 py-2 font-medium">{t("secmon.ssh.col.comment")}</th>
                  <th className="px-4 py-2 font-medium">{t("secmon.ssh.col.restriction")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {audit.keys.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-6 text-center text-subtle">
                      {t("secmon.ssh.none")}
                    </td>
                  </tr>
                )}
                {audit.keys.map((key) => (
                  <tr key={key.fingerprint + key.owner}>
                    <td data-label={t("secmon.ssh.col.account")} className="px-5 py-1.5 font-mono">{key.owner}</td>
                    <td data-label={t("secmon.ssh.col.type")} className="px-4 py-1.5 text-subtle">{key.type}</td>
                    <td data-label={t("secmon.ssh.col.fingerprint")} className="px-4 py-1.5 font-mono text-[11px]">{key.fingerprint}</td>
                    <td data-label={t("secmon.ssh.col.comment")} className="max-w-xs truncate px-4 py-1.5 text-subtle">
                      {key.comment || "—"}
                    </td>
                    <td data-label={t("secmon.ssh.col.restriction")} className="px-4 py-1.5">
                      {key.restricted ? (
                        <span className="text-ok">{t("secmon.ssh.restricted")}</span>
                      ) : (
                        <span className="text-subtle">{t("secmon.ssh.full")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

/* ---------------- Port yönlendirmeleri ---------------- */

export function ForwardsPanel({
  initial,
  canManage,
}: {
  initial: PortForward[];
  canManage: boolean;
}) {
  const t = useT();
  const f = useFormat();
  const [forwards, setForwards] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function scan() {
    setBusy(true);
    setNotice(t("secmon.upnp.asking"));
    const { data } = await api({ action: "scan-upnp" });
    setNotice(String(data.message ?? ""));
    if (data.forwards) setForwards(data.forwards as PortForward[]);
    setBusy(false);
  }

  return (
    <section className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Router className="size-4 text-subtle" aria-hidden />
          {t("secmon.upnp.title")}
          <span className="font-normal text-subtle">{forwards.length}</span>
        </h2>
        {canManage && (
          <button
            type="button"
            onClick={() => void scan()}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand disabled:opacity-50"
          >
            <RotateCw className={`size-4 ${busy ? "animate-spin" : ""}`} />{" "}
            {t("secmon.upnp.ask")}
          </button>
        )}
      </div>

      {notice && <p className="border-b border-line px-5 py-2 text-xs text-subtle">{notice}</p>}

      <p className="border-b border-line bg-brand/5 px-5 py-2 text-xs text-subtle">
        <Rich
          text={t("secmon.upnp.intro")}
          values={{ strong: <strong>{t("secmon.upnp.viaUpnp")}</strong> }}
        />
      </p>

      {forwards.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-subtle">
          {t("secmon.upnp.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {forwards.map((entry) => (
            <li key={entry.key} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
              <span className="font-mono text-xs">
                {entry.protocol}/{entry.externalPort}
              </span>
              <span className="text-xs text-subtle">
                → {entry.internalHost}:{entry.internalPort}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs">{entry.description || "—"}</span>
              {entry.note && <span className="text-xs text-brand">{entry.note}</span>}
              {!entry.acknowledged && (
                <span className="flex items-center gap-1 rounded bg-warn/15 px-1.5 py-0.5 text-[10px] font-medium text-warn">
                  <ShieldAlert className="size-3" aria-hidden /> {t("secmon.upnp.unacknowledged")}
                </span>
              )}
              <span className="text-[11px] text-subtle">
                {t("secmon.upnp.firstSeen", { when: f.dateTime(entry.firstSeen * 1000) })}
              </span>
              {canManage && (
                <div className="flex gap-1">
                  <button
                    type="button"
                    title={t("secmon.upnp.noteTitle")}
                    onClick={async () => {
                      const note = prompt(t("secmon.upnp.notePrompt"), entry.note);
                      if (note !== null) {
                        const { data } = await api({
                          action: "annotate-forward",
                          key: entry.key,
                          note,
                          acknowledged: true,
                        });
                        if (data.forwards) setForwards(data.forwards as PortForward[]);
                      }
                    }}
                    className="rounded border border-line px-2 py-1 text-[11px] text-subtle transition-colors hover:text-ink"
                  >
                    {t("secmon.upnp.note")}
                  </button>
                  <button
                    type="button"
                    title={t("secmon.upnp.forgetTitle")}
                    onClick={async () => {
                      if (confirm(t("secmon.upnp.confirmForget", { key: entry.key }))) {
                        const { data } = await api({ action: "forget-forward", key: entry.key });
                        if (data.forwards) setForwards(data.forwards as PortForward[]);
                      }
                    }}
                    className="rounded border border-line p-1.5 text-subtle transition-colors hover:text-danger"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
