"use client";

import { useState } from "react";
import { Gauge } from "lucide-react";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import type { SpeedtestResult } from "@/lib/network/speedtest";

/** M2.12 — hız testi geçmişi. */

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

/** Basit çubuk: en hızlı ölçüm tam genişlik, diğerleri ona oranlı. */
function Bar({ value, max, tone }: { value: number; max: number; tone: string }) {
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded bg-canvas">
      <span
        className={`block h-full ${tone}`}
        style={{ width: `${max > 0 ? Math.max(2, (value / max) * 100) : 0}%` }}
      />
    </span>
  );
}

export function SpeedtestSection({ initial }: { initial: SpeedtestResult[] }) {
  const [results, setResults] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setNotice(
      "Ölçülüyor… önce indirme sonra yükleme, her biri için ısınma + sabit süreli " +
        "pencere. Hat ne kadar hızlıysa o kadar çok veri akar; yarım dakikayı bulabilir.",
    );
    try {
      const response = await fetch("/api/network/speedtest", {
        method: "POST",
        headers: { [CSRF_HEADER]: readCsrfToken() },
      });
      const data = (await response.json()) as {
        result?: SpeedtestResult;
        results?: SpeedtestResult[];
        error?: string;
      };
      if (data.results) setResults(data.results);
      setNotice(
        data.result?.ok
          ? `İndirme ${data.result.downloadMbps} Mbit · yükleme ${data.result.uploadMbps} Mbit · gecikme ${data.result.pingMs} ms`
          : (data.result?.error ?? data.error ?? "Ölçüm başarısız."),
      );
    } catch {
      setNotice("Sunucuya ulaşılamadı.");
    } finally {
      setBusy(false);
    }
  }

  const successful = results.filter((entry) => entry.ok);
  const maxDown = Math.max(1, ...successful.map((entry) => entry.downloadMbps ?? 0));
  const maxUp = Math.max(1, ...successful.map((entry) => entry.uploadMbps ?? 0));

  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Gauge className="size-4 text-subtle" aria-hidden />
          Hız testi
          <span className="font-normal text-subtle">{results.length} ölçüm</span>
        </h2>
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand disabled:opacity-50"
        >
          {busy ? "Ölçülüyor…" : "Şimdi ölç"}
        </button>
      </div>

      {notice && <p className="mt-2 text-sm">{notice}</p>}

      {results.length === 0 ? (
        <p className="mt-4 text-sm text-subtle">Henüz ölçüm yok.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {results.slice(0, 12).map((entry) => (
            <li key={entry.id} className="rounded-md border border-line px-3 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                <span className="text-subtle">
                  {new Date(entry.ts * 1000).toLocaleString("tr-TR")}
                  {entry.serverName && ` · ${entry.serverName}`}
                </span>
                {entry.ok ? (
                  <span className="tabular-nums">
                    <strong>{entry.downloadMbps}</strong> ↓ / <strong>{entry.uploadMbps}</strong> ↑
                    Mbit · {entry.pingMs} ms
                    {entry.jitterMs !== null && ` (±${entry.jitterMs})`}
                  </span>
                ) : (
                  <span className="text-danger">{entry.error}</span>
                )}
              </div>

              {entry.ok && (
                <div className="mt-1.5 space-y-1">
                  <Bar value={entry.downloadMbps ?? 0} max={maxDown} tone="bg-brand" />
                  <Bar value={entry.uploadMbps ?? 0} max={maxUp} tone="bg-ok" />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
