"use client";

import { useState } from "react";
import { RotateCw, Search, Trash2 } from "lucide-react";

import { readCsrfToken } from "./detail/shared";
import { CSRF_HEADER } from "@/lib/auth/types";
import type { PruneScope } from "@/lib/providers/types";

/**
 * Docker sekmelerinin ortak araç çubuğu (M3.38).
 *
 * Öncesinde arama yalnızca Container sekmesinde vardı, yenileme hiçbir yerde
 * yoktu (kaynak listeleri sekmeye ilk girişte bir kez çekiliyordu ve sunucuda
 * bir şey değiştiğinde sayfayı yeniden yüklemek gerekiyordu), temizlik ise
 * ayrı bir sekmenin arkasındaydı.
 *
 * Üçü de her sekmede aynı yerde duruyor: kullanıcı sekme değiştirince aynı
 * düğmeyi başka bir yerde aramamalı.
 *
 * **Temizlik sekme başına DAR kapsamlı:** Image sekmesindeki düğme yalnızca
 * kullanılmayan image'ları, Volume sekmesindeki yalnızca volume'leri budar.
 * Temizlik sekmesindeki toplu panel duruyor — oradaki "her şeyi buda", burada
 * "şu an baktığın şeyi buda".
 */

export type PruneOption = { scope: PruneScope; label: string; danger: boolean };

export function TabToolbar({
  query,
  onQuery,
  placeholder,
  onRefresh,
  prune,
  canAct,
  children,
}: {
  query: string;
  onQuery: (value: string) => void;
  placeholder: string;
  onRefresh: () => void;
  /** Bu sekmenin budama kapsamı; yoksa Temizle düğmesi çizilmez. */
  prune?: PruneOption;
  canAct: boolean;
  /** Sekmeye özel ek denetimler (sütun seçici, "durmuşları göster"…). */
  children?: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [sonuc, setSonuc] = useState<{ ok: boolean; text: string } | null>(null);

  async function temizle() {
    if (!prune) return;

    const onay = prune.danger
      ? `${prune.label}\n\nBU İŞLEM VERİ SİLER ve geri alınamaz.\n\nDevam edilsin mi?`
      : `${prune.label}\n\nDevam edilsin mi?`;
    if (!confirm(onay)) return;

    setBusy(true);
    setSonuc(null);
    try {
      const response = await fetch("/api/docker/prune", {
        method: "POST",
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: JSON.stringify({ scope: prune.scope }),
      });
      const payload = (await response.json()) as {
        removed?: number;
        reclaimedBytes?: number;
        error?: string;
      };

      if (!response.ok) {
        setSonuc({ ok: false, text: payload.error ?? "Temizlik başarısız." });
      } else {
        const mb = Math.round((payload.reclaimedBytes ?? 0) / 1024 / 1024);
        setSonuc({ ok: true, text: `${payload.removed ?? 0} kayıt silindi · ${mb} MB kazanıldı.` });
        onRefresh();
      }
    } catch {
      setSonuc({ ok: false, text: "Sunucuya ulaşılamadı." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:flex-none">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder={placeholder}
            className="w-full rounded-md border border-line bg-surface py-1.5 pl-8 pr-2 text-xs outline-none focus:border-brand sm:w-52"
          />
        </div>

        <button
          type="button"
          onClick={onRefresh}
          title="Listeyi yeniden çek"
          aria-label="Yenile"
          className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1.5 text-xs text-subtle transition-colors hover:border-brand hover:text-brand"
        >
          <RotateCw className="size-3.5" aria-hidden />
          <span className="max-sm:sr-only">Yenile</span>
        </button>

        {prune && canAct && (
          <button
            type="button"
            onClick={() => void temizle()}
            disabled={busy}
            title={prune.label}
            className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1.5 text-xs text-subtle transition-colors hover:border-danger hover:text-danger disabled:opacity-40"
          >
            <Trash2 className="size-3.5" aria-hidden />
            <span className="max-sm:sr-only">{busy ? "temizleniyor…" : "Temizle"}</span>
          </button>
        )}

        {children}
      </div>

      {sonuc && (
        <p className={`text-[11px] ${sonuc.ok ? "text-ok" : "text-danger"}`}>{sonuc.text}</p>
      )}
    </div>
  );
}
