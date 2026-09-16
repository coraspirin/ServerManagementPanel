"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Server, ShieldCheck } from "lucide-react";
import { useT } from "@/lib/i18n/client";

export function LoginForm({ next }: { next?: string }) {
  const t = useT();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 2FA açıksa parola adımından sonra elde kalan kısa ömürlü bilet (M3.1).
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");

  function finish(data: { mustChangePassword?: boolean }) {
    router.replace(data.mustChangePassword ? "/login/parola" : (next ?? "/panel"));
    router.refresh();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password, remember }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? t("auth.login.failed"));
        return;
      }

      if (data.needsSecondFactor) {
        setChallenge(data.challenge as string);
        // Parola artık bellekte tutulmasın; ikinci adım için gerekmiyor.
        // `remember` KORUNUYOR: oturum ikinci adımda kuruluyor, seçim orada lazım.
        setPassword("");
        return;
      }

      finish(data);
    } catch {
      setError(t("common.errors.network"));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/2fa", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challenge, code, remember }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? t("auth.twoFactor.failed"));
        // Bilet yandıysa baştan başlamak gerekiyor; kullanıcı boşuna kod
        // denemeye devam etmesin.
        if (data.expired) {
          setChallenge(null);
          setCode("");
        }
        return;
      }

      finish(data);
    } catch {
      setError(t("common.errors.network"));
    } finally {
      setBusy(false);
    }
  }

  if (challenge) {
    return (
      <form
        onSubmit={submitCode}
        className="w-full max-w-sm rounded-lg border border-line bg-surface p-6 shadow-sm"
      >
        <div className="mb-4 flex items-center gap-2">
          <ShieldCheck className="size-6 text-brand" aria-hidden />
          <h1 className="text-lg font-semibold tracking-tight">{t("auth.twoFactor.title")}</h1>
        </div>

        <p className="text-sm text-subtle">{t("auth.twoFactor.hint")}</p>

        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus
          required
          placeholder="000000"
          className="mt-4 w-full rounded-md border border-line bg-canvas px-3 py-2 text-center font-mono text-lg tracking-[0.3em] outline-none focus:border-brand"
        />

        {error && (
          <p role="alert" className="mt-4 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-4 w-full rounded-md bg-brand px-3 py-2 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? t("auth.twoFactor.submitBusy") : t("auth.twoFactor.submit")}
        </button>

        <button
          type="button"
          onClick={() => {
            setChallenge(null);
            setCode("");
            setError(null);
          }}
          className="mt-3 w-full text-center text-xs text-subtle hover:text-ink"
        >
          {t("auth.twoFactor.restart")}
        </button>
      </form>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="w-full max-w-sm rounded-lg border border-line bg-surface p-6 shadow-sm"
    >
      <div className="mb-6 flex items-center gap-2">
        <Server className="size-6 text-brand" aria-hidden />
        <h1 className="text-lg font-semibold tracking-tight">{t("shell.brand")}</h1>
      </div>

      <label className="block text-sm">
        <span className="text-subtle">{t("auth.login.username")}</span>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoFocus
          required
          className="mt-1 w-full rounded-md border border-line bg-canvas px-3 py-2 outline-none focus:border-brand"
        />
      </label>

      <label className="mt-4 block text-sm">
        <span className="text-subtle">{t("auth.login.password")}</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          className="mt-1 w-full rounded-md border border-line bg-canvas px-3 py-2 outline-none focus:border-brand"
        />
      </label>

      <label className="mt-4 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]"
        />
        <span>
          {t("auth.login.remember")}
          <span className="mt-0.5 block text-xs text-subtle">{t("auth.login.rememberHint")}</span>
        </span>
      </label>

      {error && (
        <p role="alert" className="mt-4 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="mt-6 w-full rounded-md bg-brand px-3 py-2 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? t("auth.login.submitBusy") : t("auth.login.submit")}
      </button>
    </form>
  );
}
