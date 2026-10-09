"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Rocket } from "lucide-react";
import { useT } from "@/lib/i18n/client";

/** Parola en az bu kadar karakter — `passwordProblem` (lib/auth/users.ts) ile aynı. */
const MIN_LENGTH = 10;

const INPUT =
  "mt-1 w-full rounded-md border border-line bg-canvas px-3 py-2 outline-none focus:border-brand";

export function SetupForm() {
  const t = useT();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("admin");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== repeat) {
      setError(t("auth.password.mismatch"));
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, username, displayName, password }),
      });
      const data = await response.json();

      if (response.status === 409) {
        // Başka bir sekmede ya da başka biri tarafından tamamlanmış.
        router.replace("/login");
        return;
      }
      if (!response.ok) {
        setError(data.error ?? t("setup.failed"));
        return;
      }

      router.replace("/panel");
      router.refresh();
    } catch {
      setError(t("common.errors.network"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="w-full max-w-sm rounded-lg border border-line bg-surface p-6 shadow-sm"
    >
      <div className="mb-2 flex items-center gap-2">
        <Rocket className="size-5 text-brand" aria-hidden />
        <h1 className="text-lg font-semibold tracking-tight">{t("setup.title")}</h1>
      </div>
      <p className="text-sm text-subtle">{t("setup.intro")}</p>

      <label className="mt-4 block text-sm">
        <span className="text-subtle">{t("setup.code")}</span>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder="XXXX-XXXX-XXXX"
          required
          className={`${INPUT} font-mono uppercase tracking-wider`}
        />
      </label>
      <p className="mt-1.5 text-xs text-subtle">
        {t("setup.codeHint")}
        <code className="mt-1 block rounded bg-canvas px-2 py-1 font-mono text-[11px]">
          docker compose logs panel | grep -A3 KURULUM
        </code>
      </p>

      <label className="mt-4 block text-sm">
        <span className="text-subtle">{t("setup.username")}</span>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
          className={INPUT}
        />
      </label>

      <label className="mt-4 block text-sm">
        <span className="text-subtle">{t("setup.displayName")}</span>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          autoComplete="name"
          className={INPUT}
        />
      </label>

      <label className="mt-4 block text-sm">
        <span className="text-subtle">{t("setup.password", { min: MIN_LENGTH })}</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={MIN_LENGTH}
          required
          className={INPUT}
        />
      </label>

      <label className="mt-4 block text-sm">
        <span className="text-subtle">{t("setup.repeat")}</span>
        <input
          type="password"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          autoComplete="new-password"
          required
          className={INPUT}
        />
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
        {busy ? t("setup.submitBusy") : t("setup.submit")}
      </button>
    </form>
  );
}
