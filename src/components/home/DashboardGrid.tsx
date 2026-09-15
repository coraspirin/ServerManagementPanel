"use client";

import { useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  GripVertical,
  LayoutGrid,
  RotateCcw,
  X,
} from "lucide-react";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import type { WidgetPlacement } from "@/lib/dashboard/catalog";

/**
 * M3.13 — gösterge paneli düzeni.
 *
 * Widget'lar SUNUCUDA render ediliyor ve buraya hazır JSX olarak geliyor.
 * İstemcinin veriyi kendisi çekmesi, sunucu bileşenlerinin tamamını istemci
 * bileşenine çevirmek ve her widget için ayrı bir API ucu açmak demekti;
 * bu bileşenin bildiği tek şey SIRA ve GÖRÜNÜRLÜK.
 *
 * Sürükle-bırak için kütüphane yok: tarayıcının kendi HTML5 DnD'si tek
 * sütunlu bir liste için yeterli. `dnd-kit` ya da benzeri, kazandıracağı
 * şeyin yanında koca bir bağımlılık olurdu.
 *
 * Ama HTML5 DnD dokunmatikte çalışmaz, bu yüzden sıralamanın ikinci bir yolu
 * var: her satırdaki yukarı/aşağı düğmeleri. Onlar her cihazda görünür —
 * sürüklemeyi bilmeyen fare kullanıcısı ve klavye de aynı yolu kullanıyor.
 */

type Props = {
  layout: WidgetPlacement[];
  widgets: Record<string, ReactNode>;
};

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

export function DashboardGrid({ layout, widgets }: Props) {
  const [editing, setEditing] = useState(false);
  const [order, setOrder] = useState(layout);
  const [dragging, setDragging] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        layout?: WidgetPlacement[];
      };
      if (!response.ok || payload.ok === false) {
        setError(payload.error ?? "Düzen kaydedilemedi.");
        return false;
      }
      if (payload.layout) setOrder(payload.layout);
      return true;
    } catch {
      setError("Sunucuya ulaşılamadı.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function move(from: string, to: string) {
    if (from === to) return;
    const next = [...order];
    const fromIndex = next.findIndex((entry) => entry.key === from);
    const toIndex = next.findIndex((entry) => entry.key === to);
    if (fromIndex < 0 || toIndex < 0) return;
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setOrder(next);
  }

  /**
   * Bir adım yukarı/aşağı taşı.
   *
   * HTML5 sürükle-bırak dokunmatikte HİÇ çalışmaz — `dragstart` parmakla
   * tetiklenmez. Telefonda düzenleyici bu yüzden tamamen ölüydü; iki düğme,
   * bir sürükleme kütüphanesi eklemeden aynı işi görüyor ve klavyeyle de
   * kullanılabiliyor.
   */
  function nudge(key: string, direction: -1 | 1) {
    const index = order.findIndex((entry) => entry.key === key);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
  }

  const shown = order.filter((entry) => entry.visible);

  if (!editing) {
    return (
      <div className="space-y-6">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs text-subtle transition-colors hover:text-ink"
          >
            <LayoutGrid className="size-3.5" /> Düzeni düzenle
          </button>
        </div>

        {shown.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-5 py-8 text-center text-sm text-subtle">
            Bütün bölümleri gizlemişsin. &ldquo;Düzeni düzenle&rdquo; ile geri açabilirsin.
          </p>
        ) : (
          <Rendered order={shown} widgets={widgets} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-lg bg-danger/10 px-4 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}

      <section className="rounded-lg border border-brand/40 bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <LayoutGrid className="size-4 text-brand" aria-hidden />
            Düzeni düzenle
          </h2>
          <span className="text-xs text-subtle">
            Tut ve sürükleyerek sırala, göz simgesiyle gizle. Düzen yalnızca senin hesabına
            kaydedilir.
          </span>

          <div className="ml-auto flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (!confirm("Düzen varsayılana döndürülsün mü?")) return;
                if (await send({ action: "reset" })) setEditing(false);
              }}
              className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs text-subtle transition-colors hover:text-ink disabled:opacity-50"
            >
              <RotateCcw className="size-3.5" /> Varsayılana dön
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setOrder(layout);
                setEditing(false);
              }}
              className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs text-subtle transition-colors hover:text-ink disabled:opacity-50"
            >
              <X className="size-3.5" /> Vazgeç
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const ok = await send({
                  action: "save",
                  layout: order.map((entry) => ({ key: entry.key, visible: entry.visible })),
                });
                if (ok) setEditing(false);
              }}
              className="flex items-center gap-1.5 rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Check className="size-3.5" /> {busy ? "Kaydediliyor…" : "Kaydet"}
            </button>
          </div>
        </div>

        <ul className="mt-3 space-y-1.5">
          {order.map((entry, index) => (
            <li
              key={entry.key}
              draggable
              onDragStart={() => setDragging(entry.key)}
              onDragEnd={() => setDragging(null)}
              onDragOver={(event) => {
                // Varsayılanı engellemek ZORUNLU: engellenmezse tarayıcı
                // bırakmayı hiç kabul etmez ve sürükleme sessizce çalışmaz.
                event.preventDefault();
                if (dragging) move(dragging, entry.key);
              }}
              className={`flex items-center gap-3 rounded-md border px-3 py-2 transition-colors ${
                dragging === entry.key ? "border-brand bg-brand/5" : "border-line bg-canvas"
              } ${entry.visible ? "" : "opacity-60"}`}
            >
              <GripVertical
                className="hidden size-4 shrink-0 cursor-grab text-subtle sm:block"
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{entry.label}</div>
                <div className="text-xs text-subtle">{entry.description}</div>
              </div>
              <button
                type="button"
                aria-label={`${entry.label} yukarı taşı`}
                disabled={index === 0}
                onClick={() => nudge(entry.key, -1)}
                className="flex shrink-0 items-center justify-center rounded border border-line p-1.5 text-subtle transition-colors hover:text-ink disabled:opacity-30"
              >
                <ChevronUp className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={`${entry.label} aşağı taşı`}
                disabled={index === order.length - 1}
                onClick={() => nudge(entry.key, 1)}
                className="flex shrink-0 items-center justify-center rounded border border-line p-1.5 text-subtle transition-colors hover:text-ink disabled:opacity-30"
              >
                <ChevronDown className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={entry.visible ? `${entry.label} gizle` : `${entry.label} göster`}
                onClick={() =>
                  setOrder(
                    order.map((item) =>
                      item.key === entry.key ? { ...item, visible: !item.visible } : item,
                    ),
                  )
                }
                className="flex shrink-0 items-center justify-center rounded border border-line p-1.5 text-subtle transition-colors hover:text-ink"
              >
                {entry.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Önizleme: düzenleme sırasında sonucun ne olacağı görünür kalsın. */}
      <Rendered order={shown} widgets={widgets} />
    </div>
  );
}

/**
 * Yan yana durabilen (dar) widget'lar ikili ızgaraya toplanıyor.
 *
 * Saat ve internet göstergesi tek başına satır kaplasaydı ekranın üstü boşa
 * giderdi; ama düzenleyici tek sütunlu kaldığı için bu tamamen sunum katmanında
 * hallediliyor — kullanıcı iki boyutlu bir ızgarayla uğraşmıyor.
 */
function Rendered({
  order,
  widgets,
}: {
  order: WidgetPlacement[];
  widgets: Record<string, ReactNode>;
}) {
  const blocks: ReactNode[] = [];
  let narrow: WidgetPlacement[] = [];

  const flush = () => {
    if (narrow.length === 0) return;
    blocks.push(
      <div key={`dar-${narrow[0].key}`} className="grid gap-4 lg:grid-cols-2">
        {narrow.map((entry) => (
          <div key={entry.key} className="min-w-0">
            {widgets[entry.key]}
          </div>
        ))}
      </div>,
    );
    narrow = [];
  };

  for (const entry of order) {
    if (entry.wide) {
      flush();
      blocks.push(<div key={entry.key}>{widgets[entry.key]}</div>);
    } else {
      narrow.push(entry);
      if (narrow.length === 2) flush();
    }
  }
  flush();

  return <div className="space-y-6">{blocks}</div>;
}
