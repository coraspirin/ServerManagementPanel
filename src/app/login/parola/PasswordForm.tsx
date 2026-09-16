"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { KeyRound } from "lucide-react";
import { useT } from "@/lib/i18n/client";

/** Parola en az bu kadar karakter — hem `minLength` hem de etiket metni için. */
const MIN_LENGTH = 10;

export function PasswordForm({ forced }: { forced: boolean }) {
  const t = useT();
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (newPassword !== repeat) {
      setError(t("auth.password.mismatch"));
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? t("auth.password.failed"));
        return;
      }

      // Tüm oturumlar düştü — yeniden giriş gerekiyor.
      router.replace("/login");
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
        <KeyRound className="size-5 text-brand" aria-hidden />
        <h1 className="text-lg font-semibold tracking-tight">{t("auth.password.title")}</h1>
      </div>

      {forced && (
        <p className="mb-4 rounded-md bg-warn/10 px-3 py-2 text-sm text-warn">
          {t("auth.password.forcedNotice")}
        </p>
      )}

      <label className="mt-4 block text-sm">
        <span className="text-subtle">{t("auth.password.current")}</span>
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          required
          className="mt-1 w-full rounded-md border border-line bg-canvas px-3 py-2 outline-none focus:border-brand"
        />
      </label>

      <label className="mt-4 block text-sm">
        <span className="text-subtle">{t("auth.password.next", { min: MIN_LENGTH })}</span>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          minLength={MIN_LENGTH}
          required
          className="mt-1 w-full rounded-md border border-line bg-canvas px-3 py-2 outline-none focus:border-brand"
        />
      </label>

      <label className="mt-4 block text-sm">
        <span className="text-subtle">{t("auth.password.repeat")}</span>
        <input
          type="password"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          autoComplete="new-password"
          required
          className="mt-1 w-full rounded-md border border-line bg-canvas px-3 py-2 outline-none focus:border-brand"
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
        {busy ? t("auth.password.submitBusy") : t("auth.password.submit")}
      </button>
    </form>
  );
}
