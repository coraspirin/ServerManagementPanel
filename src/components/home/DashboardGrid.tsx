"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Check, LayoutGrid, RotateCcw, X } from "lucide-react";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import type { WidgetPlacement, WidgetSize } from "@/lib/dashboard/catalog";
import { useT } from "@/lib/i18n/client";
import { LayoutEditor } from "./LayoutEditor";

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
  /** Kiosk: düzenleme düğmesi yok — oturumsuz ekranın yazabileceği bir şey yok. */
  readOnly?: boolean;
};

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

export function DashboardGrid({ layout, widgets, readOnly = false }: Props) {
  const t = useT();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [order, setOrder] = useState(layout);
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
        setError(payload.error ?? t("home.dashboard.saveFailed"));
        return false;
      }
      if (payload.layout) setOrder(payload.layout);
      // Gizli widget'ların verisi sunucuda hiç yüklenmiyor; yeni açılan bir
      // widget'ın içeriği ancak sayfa sunucudan yeniden çizilince gelir.
      router.refresh();
      return true;
    } catch {
      setError(t("common.errors.network"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Görünür ama gösterecek bir şeyi olmayan widget (null) ızgarada yer tutmasın.
  const shown = order.filter((entry) => entry.visible && widgets[entry.key] != null);

  if (readOnly) {
    return shown.length === 0 ? null : <Rendered order={shown} widgets={widgets} />;
  }

  if (!editing) {
    return (
      <div className="space-y-6">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs text-subtle transition-colors hover:text-ink"
          >
            <LayoutGrid className="size-3.5" /> {t("home.dashboard.edit")}
          </button>
        </div>

        {shown.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-5 py-8 text-center text-sm text-subtle">
            {t("home.dashboard.allHidden")}
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
            {t("home.dashboard.edit")}
          </h2>
          <span className="text-xs text-subtle">
            {t("home.dashboard.help")}
          </span>

          <div className="ml-auto flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (!confirm(t("home.dashboard.confirmReset"))) return;
                if (await send({ action: "reset" })) setEditing(false);
              }}
              className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs text-subtle transition-colors hover:text-ink disabled:opacity-50"
            >
              <RotateCcw className="size-3.5" /> {t("home.dashboard.reset")}
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
              <X className="size-3.5" /> {t("common.actions.cancel")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const ok = await send({
                  action: "save",
                  layout: order.map((entry) => ({
                    key: entry.key,
                    visible: entry.visible,
                    size: entry.size,
                  })),
                });
                if (ok) setEditing(false);
              }}
              className="flex items-center gap-1.5 rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Check className="size-3.5" />{" "}
              {busy ? t("common.states.saving") : t("common.actions.save")}
            </button>
          </div>
        </div>

        <div className="mt-3">
          <LayoutEditor order={order} onChange={setOrder} />
        </div>
      </section>

      {/* Önizleme: düzenleme sırasında sonucun ne olacağı görünür kalsın.
          Yeni açılan bir widget'ın içeriği kaydedince gelir (bkz. `send`). */}
      <Rendered order={shown} widgets={widgets} />
    </div>
  );
}

/**
 * 12 sütunlu ızgara. Boyut sınıfları sabit dizgeler: Tailwind sınıfları
 * derlemede taradığı için `col-span-${n}` gibi üretilmiş adlar CSS'e girmez.
 *
 * Dar ekranda her widget tam genişlik; orta ekranda küçük/orta olanlar ikişer
 * yan yana; geniş ekranda 3/4/6/12 sütun.
 */
const SIZE_CLASS: Record<WidgetSize, string> = {
  sm: "md:col-span-6 xl:col-span-3",
  md: "md:col-span-6 xl:col-span-4",
  lg: "xl:col-span-6",
  full: "",
};

function Rendered({
  order,
  widgets,
}: {
  order: WidgetPlacement[];
  widgets: Record<string, ReactNode>;
}) {
  return (
    <div className="grid grid-cols-12 gap-4">
      {order.map((entry) => (
        // `*:h-full`: aynı satırdaki kartlar eşit yükseklikte dursun.
        <div key={entry.key} className={`col-span-12 min-w-0 *:h-full ${SIZE_CLASS[entry.size]}`}>
          {widgets[entry.key]}
        </div>
      ))}
    </div>
  );
}
