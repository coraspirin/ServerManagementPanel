"use client";

import { useCallback, useState } from "react";
import {
  Activity,
  Bell,
  RotateCw,
  Search,
  TrendingUp,
  UserCog,
  ZoomIn,
} from "lucide-react";
import type { Severity } from "@/lib/alerts/types";
import type { TimelineEntry, TimelineKind, TimelineResult } from "@/lib/timeline";

/**
 * M3.2 — değişiklik zaman çizelgesi.
 *
 * Bir kayda tıklamak ±30 dakikalık pencereye yakınlaştırır. Amaç tam olarak
 * şu: "şu ayarı değiştirdim, sonra ne oldu?" — cevap iki tık ötede olmalı,
 * üç ayrı ekranda tarih eşleştirerek değil.
 */

const KIND_META: Record<TimelineKind, { label: string; icon: typeof Bell; tone: string }> = {
  audit: { label: "Değişiklik", icon: UserCog, tone: "text-brand" },
  event: { label: "Olay", icon: Bell, tone: "text-warn" },
  spike: { label: "Sıçrama", icon: TrendingUp, tone: "text-subtle" },
};

const SEVERITY_DOT: Record<Severity, string> = {
  ok: "bg-ok",
  info: "bg-brand",
  warning: "bg-warn",
  critical: "bg-danger",
};

const RANGES: { label: string; seconds: number }[] = [
  { label: "1 sa", seconds: 3600 },
  { label: "6 sa", seconds: 6 * 3600 },
  { label: "24 sa", seconds: 24 * 3600 },
  { label: "7 gün", seconds: 7 * 86400 },
  { label: "30 gün", seconds: 30 * 86400 },
];

const ZOOM_SECONDS = 30 * 60;

function clock(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function dayLabel(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/** Ardışık kayıtları güne göre grupla — 500 satırlık düz liste okunmuyor. */
function groupByDay(entries: TimelineEntry[]): [string, TimelineEntry[]][] {
  const groups: [string, TimelineEntry[]][] = [];
  for (const entry of entries) {
    const key = dayLabel(entry.ts);
    const last = groups[groups.length - 1];
    if (last && last[0] === key) last[1].push(entry);
    else groups.push([key, [entry]]);
  }
  return groups;
}

export function TimelineView({
  initial,
  canSeeAudit,
}: {
  initial: TimelineResult;
  canSeeAudit: boolean;
}) {
  const [data, setData] = useState(initial);
  const [range, setRange] = useState<{ since: number; until: number } | null>(null);
  const [rangeSeconds, setRangeSeconds] = useState(24 * 3600);
  const [kinds, setKinds] = useState<TimelineKind[]>(
    canSeeAudit ? ["audit", "event", "spike"] : ["event", "spike"],
  );
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (window: { since: number; until: number } | null, seconds: number, active: TimelineKind[], q: string) => {
      setBusy(true);
      try {
        const params = new URLSearchParams();
        if (window) {
          params.set("since", String(window.since));
          params.set("until", String(window.until));
        } else {
          params.set("since", String(Math.floor(Date.now() / 1000) - seconds));
        }
        if (active.length > 0) params.set("kinds", active.join(","));
        if (q.trim()) params.set("q", q.trim());

        const response = await fetch(`/api/timeline?${params.toString()}`, {
          cache: "no-store",
        });
        if (response.ok) setData((await response.json()) as TimelineResult);
      } catch {
        // Ağ hatası: ekrandaki çizelge yerinde kalır.
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  // Filtre değişikliklerini tek yerden yürüt; her toggle kendi fetch'ini
  // yazmasın diye durum güncellemesi ve yükleme aynı fonksiyonda.
  function apply(next: {
    window?: { since: number; until: number } | null;
    seconds?: number;
    kinds?: TimelineKind[];
    q?: string;
  }) {
    const window = next.window !== undefined ? next.window : range;
    const seconds = next.seconds ?? rangeSeconds;
    const active = next.kinds ?? kinds;
    const q = next.q ?? query;

    if (next.window !== undefined) setRange(next.window);
    if (next.seconds !== undefined) setRangeSeconds(next.seconds);
    if (next.kinds !== undefined) setKinds(next.kinds);
    if (next.q !== undefined) setQuery(next.q);

    void load(window, seconds, active, q);
  }

  function toggleKind(kind: TimelineKind) {
    apply({ kinds: kinds.includes(kind) ? kinds.filter((k) => k !== kind) : [...kinds, kind] });
  }

  const groups = groupByDay(data.entries);
  const zoomed = range !== null;

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          {!zoomed ? (
            <div className="flex rounded-md border border-line">
              {RANGES.map((entry) => (
                <button
                  key={entry.label}
                  type="button"
                  onClick={() => apply({ seconds: entry.seconds, window: null })}
                  className={`px-2.5 py-1 text-sm transition-colors first:rounded-l-md last:rounded-r-md ${
                    rangeSeconds === entry.seconds
                      ? "bg-brand/10 font-medium text-brand"
                      : "text-subtle hover:text-ink"
                  }`}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => apply({ window: null })}
              className="flex items-center gap-1.5 rounded-md border border-brand bg-brand/10 px-3 py-1 text-sm text-brand"
            >
              <ZoomIn className="size-3.5" />
              {clock(data.since)} – {clock(data.until)} · uzaklaş
            </button>
          )}

          <div className="flex gap-1">
            {(Object.keys(KIND_META) as TimelineKind[])
              .filter((kind) => kind !== "audit" || canSeeAudit)
              .map((kind) => {
                const meta = KIND_META[kind];
                const Icon = meta.icon;
                const on = kinds.includes(kind);
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => toggleKind(kind)}
                    className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm transition-colors ${
                      on
                        ? "border-line bg-canvas text-ink"
                        : "border-transparent text-subtle opacity-50 hover:opacity-100"
                    }`}
                  >
                    <Icon className={`size-3.5 ${on ? meta.tone : ""}`} aria-hidden />
                    {meta.label}
                    <span className="text-xs text-subtle">{data.counts[kind]}</span>
                  </button>
                );
              })}
          </div>

          <div className="relative min-w-0 flex-1 sm:min-w-48">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") apply({});
              }}
              placeholder="Çizelgede ara…"
              className="w-full rounded-md border border-line bg-canvas py-1 pl-9 pr-3 text-sm outline-none focus:border-brand"
            />
          </div>

          <button
            type="button"
            onClick={() => apply({})}
            disabled={busy}
            title="Yenile"
            className="rounded-md border border-line p-1.5 text-subtle transition-colors hover:text-ink disabled:opacity-50"
          >
            <RotateCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
          </button>
        </div>

        {!canSeeAudit && (
          <p className="mt-2 text-xs text-subtle">
            Ayar ve yapılandırma değişiklikleri çizelgede görünmüyor — bunun için denetim
            kaydı görüntüleme yetkisi gerekiyor.
          </p>
        )}
      </section>

      {data.entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-surface px-5 py-12 text-center text-sm text-subtle">
          Bu aralıkta kayıt yok.
        </p>
      ) : (
        <div className="space-y-5">
          {groups.map(([day, items]) => (
            <section key={day}>
              <h3 className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wider text-subtle">
                <Activity className="size-3.5" aria-hidden />
                {day}
                <span className="font-normal normal-case tracking-normal">
                  {items.length} kayıt
                </span>
              </h3>

              <ol className="relative space-y-px border-l border-line pl-4">
                {items.map((entry) => (
                  <Entry
                    key={entry.id}
                    entry={entry}
                    onZoom={() =>
                      apply({
                        window: {
                          since: entry.ts - ZOOM_SECONDS,
                          until: entry.ts + ZOOM_SECONDS,
                        },
                      })
                    }
                  />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}

      {data.truncated && (
        <p className="text-center text-xs text-subtle">
          Sonuç kesildi — en yeni 500 kayıt gösteriliyor. Aralığı daraltarak devamını görebilirsin.
        </p>
      )}
    </div>
  );
}

function Entry({ entry, onZoom }: { entry: TimelineEntry; onZoom: () => void }) {
  const meta = KIND_META[entry.kind];
  const Icon = meta.icon;

  return (
    <li className="group relative">
      <span
        className={`absolute -left-[1.3rem] top-3 size-2 rounded-full ring-2 ring-canvas ${
          SEVERITY_DOT[entry.severity]
        }`}
        aria-hidden
      />
      <button
        type="button"
        onClick={onZoom}
        title="Bu anın çevresine yakınlaş (±30 dk)"
        className="flex w-full items-start gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-line/40"
      >
        <span className="w-16 shrink-0 pt-px font-mono text-xs tabular-nums text-subtle">
          {clock(entry.ts)}
        </span>
        <Icon className={`mt-0.5 size-3.5 shrink-0 ${meta.tone}`} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm">
            {entry.title}
            {entry.actor && <span className="ml-1.5 text-xs text-subtle">— {entry.actor}</span>}
          </span>
          {entry.detail && (
            <span className="block text-xs text-subtle">{entry.detail}</span>
          )}
        </span>
        <ZoomIn className="mt-0.5 size-3.5 shrink-0 text-subtle opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
    </li>
  );
}
