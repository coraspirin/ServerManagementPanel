"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { formatBytes } from "@/lib/metrics/catalog";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import type { PruneResult, PruneScope } from "@/lib/providers/types";

/**
 * Disk temizliği (M1.7).
 *
 * Her kapsamın NE SİLDİĞİ ve GERİ ALINABİLİR OLUP OLMADIĞI açıkça yazıyor.
 * "prune" kelimesi zararsız duruyor ama `volumes` seçeneği veri siler; bunu
 * küçük puntoyla geçiştirmek yerine kırmızıyla söylemek gerekiyor.
 */

const SCOPES: {
  value: PruneScope;
  label: string;
  detail: string;
  danger?: boolean;
}[] = [
  {
    value: "images-dangling",
    label: "Sarkan image'lar",
    detail: "Etiketi kalmamış ara katmanlar. Hiçbir container kullanmıyor, en güvenli seçenek.",
  },
  {
    value: "build-cache",
    label: "Derleme önbelleği",
    detail: "Yeniden derlemede tekrar oluşur; yalnızca ilk derleme yavaşlar.",
  },
  {
    value: "containers",
    label: "Durmuş container'lar",
    detail: "Çalışmayan container kayıtları. Volume'lardaki veri etkilenmez.",
  },
  {
    value: "networks",
    label: "Kullanılmayan ağlar",
    detail: "Hiçbir container'ın bağlı olmadığı Docker ağları.",
  },
  {
    value: "images-unused",
    label: "Kullanılmayan tüm image'lar",
    detail: "Çok yer açar ama geri getirmek yeniden indirmek demektir. İnternet gerekir.",
    danger: true,
  },
  {
    value: "volumes",
    label: "Bağlı olmayan volume'lar",
    detail: "VERİ SİLER. Bir container geçici olarak durdurulduysa volume'u burada 'kullanılmıyor' görünür.",
    danger: true,
  },
];

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

export function PrunePanel() {
  const [busy, setBusy] = useState<PruneScope | null>(null);
  const [result, setResult] = useState<PruneResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(scope: PruneScope, danger: boolean, label: string) {
    const message = danger
      ? `"${label}" temizliği GERİ ALINAMAZ.\n\nDevam edilsin mi?`
      : `"${label}" temizlensin mi?`;
    if (!confirm(message)) return;

    setBusy(scope);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/docker/prune", {
        method: "POST",
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: JSON.stringify({ scope }),
      });
      const data = (await response.json()) as PruneResult & { error?: string };
      if (!response.ok) setError(data.error ?? "Temizlik başarısız.");
      else setResult(data);
    } catch {
      setError("Sunucuya ulaşılamadı.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-lg border border-line bg-surface">
      <div className="border-b border-line px-5 py-3">
        <h2 className="flex items-center gap-1.5 font-semibold">
          <Trash2 className="size-4" /> Disk temizliği
        </h2>
        <p className="mt-0.5 text-xs text-subtle">
          Kullanılmayan Docker kaynaklarını siler. Her işlem audit&apos;e düşer.
        </p>
      </div>

      <div className="divide-y divide-line">
        {SCOPES.map((scope) => (
          <div
            key={scope.value}
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium">
                {scope.label}
                {scope.danger && (
                  <span className="ml-2 rounded bg-danger/15 px-1.5 py-0.5 text-[10px] font-medium text-danger">
                    dikkat
                  </span>
                )}
              </div>
              <p className={`mt-0.5 text-xs ${scope.danger ? "text-danger" : "text-subtle"}`}>
                {scope.detail}
              </p>
            </div>

            <button
              type="button"
              onClick={() => void run(scope.value, scope.danger === true, scope.label)}
              disabled={busy !== null}
              className={`shrink-0 rounded-md border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50 ${
                scope.danger
                  ? "border-danger/40 text-danger hover:bg-danger/10"
                  : "border-line hover:border-brand hover:text-brand"
              }`}
            >
              {busy === scope.value ? "temizleniyor…" : "Temizle"}
            </button>
          </div>
        ))}
      </div>

      {(result || error) && (
        <div className="border-t border-line px-5 py-3 text-sm">
          {error ? (
            <p className="text-danger">{error}</p>
          ) : result ? (
            <>
              <p className="text-ok">
                {result.removed} kaynak silindi · {formatBytes(result.reclaimedBytes)} kazanıldı
              </p>
              {result.items.length > 0 && (
                <p className="mt-1 break-all font-mono text-[11px] text-subtle">
                  {result.items.join(", ")}
                </p>
              )}
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}
