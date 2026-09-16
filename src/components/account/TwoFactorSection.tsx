"use client";

import { useState } from "react";
import { Copy, KeyRound, ShieldCheck, ShieldOff, Smartphone } from "lucide-react";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import { useT } from "@/lib/i18n/client";
import { Rich } from "@/lib/i18n/rich";

/**
 * M3.1 — kendi hesabının iki adımlı doğrulaması.
 *
 * Akış bilinçli olarak üç adım: QR → kod doğrula → kurtarma kodları. Ortadaki
 * doğrulama olmadan 2FA açılsaydı, QR'ı okutamayan kullanıcı kendi hesabından
 * kilitlenirdi ve geri dönüşü veritabanını elle açmak olurdu.
 */

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

async function send(method: string, body?: unknown) {
  const response = await fetch("/api/auth/totp", {
    method,
    headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, data: (await response.json()) as Record<string, unknown> };
}

type Stage =
  | { name: "idle" }
  | { name: "enrolling"; secret: string; qrSvg: string }
  | { name: "codes"; codes: string[] };

export function TwoFactorSection({
  enabled: initialEnabled,
  recoveryCodesLeft: initialLeft,
}: {
  enabled: boolean;
  recoveryCodesLeft: number;
}) {
  const t = useT();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [left, setLeft] = useState(initialLeft);
  const [stage, setStage] = useState<Stage>({ name: "idle" });
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    const { response, data } = await send("POST");
    setBusy(false);
    if (!response.ok) {
      setError(String(data.error ?? t("account.twoFactor.startFailed")));
      return;
    }
    setStage({ name: "enrolling", secret: String(data.secret), qrSvg: String(data.qrSvg) });
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    const { response, data } = await send("PUT", { code });
    setBusy(false);
    if (!response.ok) {
      setError(String(data.error ?? t("auth.twoFactor.failed")));
      return;
    }
    setEnabled(true);
    setCode("");
    const codes = (data.recoveryCodes as string[]) ?? [];
    setLeft(codes.length);
    setStage({ name: "codes", codes });
  }

  async function disable() {
    setBusy(true);
    setError(null);
    const { response, data } = await send("DELETE", { password });
    setBusy(false);
    if (!response.ok) {
      setError(String(data.error ?? t("account.twoFactor.disableFailed")));
      return;
    }
    setEnabled(false);
    setLeft(0);
    setPassword("");
    setStage({ name: "idle" });
  }

  async function regenerate() {
    setBusy(true);
    setError(null);
    const { response, data } = await send("PATCH", { password });
    setBusy(false);
    if (!response.ok) {
      setError(String(data.error ?? t("account.twoFactor.regenerateFailed")));
      return;
    }
    setPassword("");
    const codes = (data.recoveryCodes as string[]) ?? [];
    setLeft(codes.length);
    setStage({ name: "codes", codes });
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        {enabled ? (
          <ShieldCheck className="size-4 text-ok" aria-hidden />
        ) : (
          <ShieldOff className="size-4 text-subtle" aria-hidden />
        )}
        {t("auth.twoFactor.title")}
        <span className={`text-xs font-normal ${enabled ? "text-ok" : "text-subtle"}`}>
          {enabled ? t("account.twoFactor.on") : t("account.twoFactor.off")}
        </span>
      </h2>

      <p className="mt-1 text-xs leading-snug text-subtle">
        {t("account.twoFactor.intro")}
      </p>

      {enabled && left === 0 && stage.name === "idle" && (
        <p className="mt-3 rounded-md bg-warn/10 px-3 py-2 text-xs text-warn">
          {t("account.twoFactor.noCodesLeft")}
        </p>
      )}

      {stage.name === "codes" && (
        <div className="mt-4 rounded-md border border-brand/40 bg-brand/5 p-4">
          <p className="text-sm font-medium">{t("account.twoFactor.codesTitle")}</p>
          <p className="mt-1 text-xs text-subtle">
            {t("account.twoFactor.codesIntro")}
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm sm:grid-cols-3">
            {stage.codes.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(stage.codes.join("\n"))}
              className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-sm transition-colors hover:border-brand"
            >
              <Copy className="size-4" /> {t("common.actions.copy")}
            </button>
            <button
              type="button"
              onClick={() => setStage({ name: "idle" })}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              {t("account.saved")}
            </button>
          </div>
        </div>
      )}

      {stage.name === "enrolling" && (
        <div className="mt-4 space-y-3">
          <ol className="space-y-3 text-sm">
            <li>
              <span className="font-medium">1.</span> {t("account.twoFactor.step1")}
              <div
                className="mt-2 inline-block rounded-md border border-line bg-white p-2"
                // Sunucuda üretilmiş, kullanıcı girdisi içermeyen SVG.
                dangerouslySetInnerHTML={{ __html: stage.qrSvg }}
              />
            </li>
            <li>
              <span className="font-medium">2.</span> {t("account.twoFactor.step2")}
              <code className="ml-1 select-all break-all rounded bg-canvas px-1.5 py-0.5 font-mono text-xs">
                {stage.secret}
              </code>
            </li>
            <li>
              <span className="font-medium">3.</span> {t("account.twoFactor.step3")}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="000000"
                  className="w-32 rounded-md border border-line bg-canvas px-3 py-1.5 text-center font-mono tracking-widest outline-none focus:border-brand"
                />
                <button
                  type="button"
                  onClick={() => void confirm()}
                  disabled={busy || code.length < 6}
                  className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {t("account.twoFactor.verifyEnable")}
                </button>
                <button
                  type="button"
                  onClick={() => setStage({ name: "idle" })}
                  className="rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:text-ink"
                >
                  {t("common.actions.cancel")}
                </button>
              </div>
            </li>
          </ol>
        </div>
      )}

      {stage.name === "idle" && (
        <div className="mt-4">
          {!enabled ? (
            <button
              type="button"
              onClick={() => void start()}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Smartphone className="size-4" /> {t("account.twoFactor.enable")}
            </button>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-subtle">
                <Rich
                  text={t("account.twoFactor.codesLeft")}
                  values={{ count: <strong>{left}</strong> }}
                />
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("account.twoFactor.confirmPassword")}
                  className="w-full max-w-52 rounded-md border border-line bg-canvas px-3 py-1.5 text-sm outline-none focus:border-brand"
                />
                <button
                  type="button"
                  onClick={() => void regenerate()}
                  disabled={busy || !password}
                  className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand disabled:opacity-50"
                >
                  <KeyRound className="size-4" /> {t("account.twoFactor.regenerate")}
                </button>
                <button
                  type="button"
                  onClick={() => void disable()}
                  disabled={busy || !password}
                  className="rounded-md border border-line px-3 py-1.5 text-sm text-danger transition-colors hover:border-danger disabled:opacity-50"
                >
                  {t("account.twoFactor.disable")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </section>
  );
}
