"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Lock } from "lucide-react";

/**
 * Kendi parolanı değiştirme. Başarılı olduğunda TÜM oturumlar düşer — bu
 * ekranınki dahil. Sürpriz olmasın diye düğmenin altında yazıyor.
 */
export function PasswordSection() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (next !== repeat) {
      setError("Yeni parolalar eşleşmiyor.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Değiştirilemedi.");
        return;
      }
      router.replace("/login");
      router.refresh();
    } catch {
      setError("Sunucuya ulaşılamadı.");
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "mt-1 w-full rounded-md border border-line bg-canvas px-3 py-1.5 text-sm outline-none focus:border-brand";

  return (
    <form onSubmit={submit} className="rounded-lg border border-line bg-surface p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Lock className="size-4 text-subtle" aria-hidden />
        Parola
      </h2>
      <p className="mt-1 text-xs text-subtle">
        En az 10 karakter, en az bir harf ve bir rakam.
      </p>

      <div className="mt-4 grid gap-3 sm:max-w-sm">
        <label className="block text-sm">
          <span className="text-subtle">Mevcut parola</span>
          <input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
            className={inputClass}
          />
        </label>
        <label className="block text-sm">
          <span className="text-subtle">Yeni parola</span>
          <input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
            className={inputClass}
          />
        </label>
        <label className="block text-sm">
          <span className="text-subtle">Yeni parola (tekrar)</span>
          <input
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            required
            className={inputClass}
          />
        </label>
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="mt-4 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Değiştiriliyor…" : "Parolayı değiştir"}
      </button>
      <p className="mt-2 text-xs text-subtle">
        Değiştirdiğinde açık olan tüm oturumlar kapanır ve yeniden giriş yapman istenir.
      </p>
    </form>
  );
}
