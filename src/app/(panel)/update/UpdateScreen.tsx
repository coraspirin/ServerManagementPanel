"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, CloudDownload, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import { formatDateTime } from "@/lib/i18n/format";
import { useDict, useDynamicT, useT } from "@/lib/i18n/client";
import type { UpdateCheck, UpdateStatus } from "@/lib/selfupdate";

const BTN =
  "flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50";
const BTN_SECONDARY =
  "flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand disabled:opacity-50";

const PHASE_STYLE: Record<UpdateStatus["phase"], string> = {
  idle: "bg-line text-subtle",
  running: "bg-brand/15 text-brand",
  done: "bg-ok/15 text-ok",
  failed: "bg-danger/15 text-danger",
  rolledBack: "bg-warn/15 text-warn",
};

const POLL_MS = 2_000;

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

type Snapshot = { check: UpdateCheck; status: UpdateStatus };

export function UpdateScreen({
  initialCheck,
  initialStatus,
}: {
  initialCheck: UpdateCheck;
  initialStatus: UpdateStatus;
}) {
  const t = useT();
  const tk = useDynamicT();
  const dict = useDict();
  const [check, setCheck] = useState(initialCheck);
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Panel yeniden başlarken istekler düşer; bu "hata" değil, beklenen an.
  const [reconnecting, setReconnecting] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  const load = useCallback(async (refresh = false): Promise<Snapshot | null> => {
    const response = await fetch(`/api/updates/panel${refresh ? "?refresh=1" : ""}`, {
      cache: "no-store",
    }).catch(() => null);
    if (!response?.ok) return null;
    return (await response.json()) as Snapshot;
  }, []);

  const polling = status.phase === "running" || reconnecting;

  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(async () => {
      const snapshot = await load();
      if (!snapshot) {
        setReconnecting(true);
        return;
      }
      setReconnecting(false);
      setCheck(snapshot.check);
      setStatus(snapshot.status);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [polling, load]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [status.log.length]);

  async function refresh() {
    setBusy(true);
    setError("");
    const snapshot = await load(true);
    setBusy(false);
    if (!snapshot) return;
    setCheck(snapshot.check);
    setStatus(snapshot.status);
  }

  async function install(tag: string) {
    if (!window.confirm(t("update.confirm", { tag }))) return;
    setBusy(true);
    setError("");
    const response = await fetch("/api/updates/panel", {
      method: "POST",
      headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
      body: JSON.stringify({ tag }),
    }).catch(() => null);
    setBusy(false);
    if (!response) return setError(t("update.network"));
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      return setError(data.error ?? `HTTP ${response.status}`);
    }
    setStatus((previous) => ({ ...previous, phase: "running", tag, detail: "start", log: [] }));
  }

  const upgraded = check.current !== initialCheck.current;
  const running = status.phase === "running";

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <section className="rounded-lg border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-subtle">{t("update.current")}</dt>
            <dd className="font-mono">v{check.current}</dd>
            <dt className="text-subtle">{t("update.latest")}</dt>
            <dd className="font-mono">{check.latest ?? "—"}</dd>
            <dt className="text-subtle">{t("update.repo")}</dt>
            <dd className="font-mono text-xs leading-5">{check.repo}</dd>
          </dl>
          <button type="button" className={BTN_SECONDARY} disabled={busy || running} onClick={refresh}>
            <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} aria-hidden />
            {t("update.check")}
          </button>
        </div>

        <p className="mt-3 text-xs text-subtle">
          {t("update.checkedAt", { time: formatDateTime(check.checkedAt, dict) })}
        </p>
        {check.error && <p className="mt-2 text-sm text-danger">{check.error}</p>}

        {!check.error && !check.newer && check.latest && (
          <p className="mt-4 flex items-center gap-2 text-sm text-ok">
            <CheckCircle2 className="size-4" aria-hidden />
            {t("update.upToDate")}
          </p>
        )}

        {check.newer && check.latest && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-brand/30 bg-brand/5 p-3">
            <p className="text-sm font-medium">{t("update.available", { tag: check.latest })}</p>
            {check.compareUrl && (
              <a
                href={check.compareUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-sm text-brand hover:underline"
              >
                {t("update.changes")}
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            )}
            <button
              type="button"
              className={`${BTN} ml-auto`}
              disabled={busy || running}
              onClick={() => install(check.latest as string)}
            >
              <CloudDownload className="size-4" aria-hidden />
              {t("update.install", { tag: check.latest })}
            </button>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </section>

      <section className="rounded-lg border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">{t("update.statusTitle")}</h2>
          {status.phase !== "idle" && (
            <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${PHASE_STYLE[status.phase]}`}>
              {tk(`update.phase.${status.phase}`)}
              {status.tag ? ` · ${status.tag}` : ""}
            </span>
          )}
          {running && <Loader2 className="size-4 animate-spin text-brand" aria-hidden />}
          {status.at && (
            <span className="ml-auto text-xs text-subtle">{formatDateTime(status.at * 1000, dict)}</span>
          )}
        </div>

        {status.phase === "idle" && <p className="mt-2 text-sm text-subtle">{t("update.phase.idle")}</p>}
        {status.detail && status.phase !== "done" && (
          <p className="mt-2 text-sm text-subtle">{t("update.detail", { detail: status.detail })}</p>
        )}
        {reconnecting && <p className="mt-2 text-sm text-warn">{t("update.restarting")}</p>}

        {upgraded && status.phase === "done" && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p className="text-sm text-ok">{t("update.finished", { version: check.current })}</p>
            <button type="button" className={BTN_SECONDARY} onClick={() => window.location.reload()}>
              {t("update.reload")}
            </button>
          </div>
        )}

        {status.log.length > 0 && (
          <>
            <p className="mb-1 mt-4 text-xs font-semibold text-subtle">{t("update.log")}</p>
            <pre
              ref={logRef}
              className="thin-scrollbar max-h-72 overflow-auto rounded-md border border-line bg-canvas p-3 font-mono text-xs leading-5"
            >
              {status.log.join("\n")}
            </pre>
          </>
        )}
      </section>

      <section className="rounded-lg border border-dashed border-line p-5 text-sm text-subtle">
        <h2 className="mb-2 font-semibold text-ink">{t("update.howTitle")}</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>{t("update.how.download")}</li>
          <li>{t("update.how.preserved")}</li>
          <li>{t("update.how.rollback")}</li>
          <li>{t("update.how.requirements")}</li>
        </ul>
      </section>
    </div>
  );
}
