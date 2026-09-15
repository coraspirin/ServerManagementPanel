"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { KeyRound } from "lucide-react";

export function PasswordForm({ forced }: { forced: boolean }) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (newPassword !== repeat) {
      setError("Yeni parolalar eşleşmiyor.");
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
        setError(data.error ?? "Parola değiştirilemedi.");
        return;
      }

      // Tüm oturumlar düştü — yeniden giriş gerekiyor.
      router.replace("/login");
      router.refresh();
    } catch {
      setError("Sunucuya ulaşılamadı.");
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
        <h1 className="text-lg font-semibold tracking-tight">Parola değiştir</h1>
      </div>

      {forced && (
        <p className="mb-4 rounded-md bg-warn/10 px-3 py-2 text-sm text-warn">
          İlk giriş parolası kurulum logunda görünür. Devam etmeden önce
          değiştirmelisin.
        </p>
      )}

      <label className="mt-4 block text-sm">
        <span className="text-subtle">Mevcut parola</span>
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
        <span className="text-subtle">Yeni parola (en az 10 karakter)</span>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          minLength={10}
          required
          className="mt-1 w-full rounded-md border border-line bg-canvas px-3 py-2 outline-none focus:border-brand"
        />
      </label>

      <label className="mt-4 block text-sm">
        <span className="text-subtle">Yeni parola (tekrar)</span>
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
        {busy ? "Değiştiriliyor…" : "Parolayı değiştir"}
      </button>
    </form>
  );
}
