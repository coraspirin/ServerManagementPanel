"use client";

import { useState } from "react";
import { MonitorSmartphone, Plus, Trash2 } from "lucide-react";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import type { KioskTokenView } from "@/lib/home/kiosk";

/**
 * M2.7 — kiosk bağlantıları.
 *
 * Üretilen adres YALNIZCA BİR KEZ gösteriliyor: veritabanında yalnızca özeti
 * duruyor. Bunu kullanıcıya söylemek şart, yoksa pencereyi kapatıp "nerede bu
 * bağlantı" diye arar.
 */

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function formatDate(ts: number | null): string {
  return ts === null
    ? "—"
    : new Date(ts * 1000).toLocaleString("tr-TR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export function KioskManager({ initialTokens }: { initialTokens: KioskTokenView[] }) {
  const [tokens, setTokens] = useState(initialTokens);
  const [name, setName] = useState("");
  const [days, setDays] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    setFresh(null);
    try {
      const response = await fetch("/api/kiosk", {
        method: "POST",
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: JSON.stringify({ name, days: days === "" ? 0 : Number(days) }),
      });
      const data = (await response.json()) as {
        error?: string;
        token?: string;
        tokens?: KioskTokenView[];
      };
      if (!response.ok) {
        setError(data.error ?? "Bağlantı üretilemedi.");
        return;
      }
      if (data.tokens) setTokens(data.tokens);
      // Tam adres burada kuruluyor: kullanıcının paneli açtığı adres, tabletin
      // de ulaşabileceği adrestir.
      setFresh(`${window.location.origin}/kiosk/${data.token}`);
      setName("");
      setDays("");
    } catch {
      setError("Sunucuya ulaşılamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(token: KioskTokenView) {
    if (!confirm(`"${token.name || token.fingerprint}" bağlantısı iptal edilsin mi?`)) return;

    setBusy(true);
    try {
      const response = await fetch(`/api/kiosk?fingerprint=${token.fingerprint}`, {
        method: "DELETE",
        headers: { [CSRF_HEADER]: readCsrfToken() },
      });
      const data = (await response.json()) as { tokens?: KioskTokenView[]; error?: string };
      if (response.ok && data.tokens) setTokens(data.tokens);
      else setError(data.error ?? "İptal edilemedi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <MonitorSmartphone className="size-4 text-subtle" aria-hidden />
        Kiosk bağlantıları
      </h2>
      <p className="mt-1 text-xs text-subtle">
        Duvara asılı tablet/monitör için oturum gerektirmeyen, salt-okunur bir görünüm.
        Adresteki token yetkiyi taşır — yazma yapan hiçbir uç bu yolu kabul etmez.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="text-xs font-medium">Ad</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Mutfak tableti"
            className="mt-1 rounded-md border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium">Geçerlilik (gün)</span>
          <input
            type="number"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            placeholder="boş = süresiz"
            className="mt-1 w-32 rounded-md border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand"
          />
        </label>
        <button
          type="button"
          onClick={() => void create()}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand disabled:opacity-50"
        >
          <Plus className="size-4" /> Bağlantı üret
        </button>
      </div>

      {fresh && (
        <div className="mt-3 rounded-md border border-brand/40 bg-brand/5 px-3 py-2">
          <p className="text-xs font-medium">
            Bu adres bir daha gösterilmeyecek — şimdi kopyala.
          </p>
          <code className="mt-1 block break-all font-mono text-xs">{fresh}</code>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      {tokens.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-md border border-line">
          {tokens.map((token) => (
            <li key={token.fingerprint} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{token.name || "(adsız)"}</span>
                <span className="block text-[11px] text-subtle">
                  {token.fingerprint} · son kullanım {formatDate(token.lastSeenAt)} ·{" "}
                  {token.expiresAt === null
                    ? "süresiz"
                    : `bitiş ${formatDate(token.expiresAt)}`}
                </span>
              </span>
              <button
                type="button"
                onClick={() => void revoke(token)}
                disabled={busy}
                aria-label={`${token.name || token.fingerprint} bağlantısını iptal et`}
                className="rounded p-1 text-subtle transition-colors hover:text-danger disabled:opacity-50"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
