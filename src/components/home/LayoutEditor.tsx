"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Eye, EyeOff, GripVertical } from "lucide-react";
import { WIDGET_SIZES, type WidgetPlacement, type WidgetSize } from "@/lib/dashboard/catalog";
import { useT } from "@/lib/i18n/client";

/**
 * Widget listesi düzenleyicisi — sıra, boyut, görünürlük.
 *
 * Hem kişisel gösterge paneli (DashboardGrid) hem kiosk bağlantısı düzeni
 * (KioskManager) bunu kullanıyor; iki ayrı düzenleyici zamanla birbirinden
 * kopardı. Durum dışarıda tutuluyor, bileşen yalnızca yeni sırayı bildiriyor.
 *
 * Sürükle-bırak için kütüphane yok: tarayıcının kendi HTML5 DnD'si tek
 * sütunlu bir liste için yeterli. Ama HTML5 DnD dokunmatikte çalışmaz, bu
 * yüzden her satırda yukarı/aşağı düğmeleri de var — klavye de aynı yolu
 * kullanıyor.
 */
export function LayoutEditor({
  order,
  onChange,
}: {
  order: WidgetPlacement[];
  onChange: (next: WidgetPlacement[]) => void;
}) {
  const t = useT();
  const [dragging, setDragging] = useState<string | null>(null);

  function move(from: string, to: string) {
    if (from === to) return;
    const next = [...order];
    const fromIndex = next.findIndex((entry) => entry.key === from);
    const toIndex = next.findIndex((entry) => entry.key === to);
    if (fromIndex < 0 || toIndex < 0) return;
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    onChange(next);
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
    onChange(next);
  }

  return (
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
          <select
            value={entry.size}
            aria-label={t("home.dashboard.size", { name: entry.label })}
            onChange={(event) =>
              onChange(
                order.map((item) =>
                  item.key === entry.key
                    ? { ...item, size: event.target.value as WidgetSize }
                    : item,
                ),
              )
            }
            className="shrink-0 rounded border border-line bg-surface px-1.5 py-1 text-xs text-subtle"
          >
            {WIDGET_SIZES.map((size) => (
              <option key={size} value={size}>
                {t(`home.dashboard.sizes.${size}`)}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label={t("home.dashboard.moveUp", { name: entry.label })}
            disabled={index === 0}
            onClick={() => nudge(entry.key, -1)}
            className="flex shrink-0 items-center justify-center rounded border border-line p-1.5 text-subtle transition-colors hover:text-ink disabled:opacity-30"
          >
            <ChevronUp className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={t("home.dashboard.moveDown", { name: entry.label })}
            disabled={index === order.length - 1}
            onClick={() => nudge(entry.key, 1)}
            className="flex shrink-0 items-center justify-center rounded border border-line p-1.5 text-subtle transition-colors hover:text-ink disabled:opacity-30"
          >
            <ChevronDown className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={t(entry.visible ? "home.dashboard.hide" : "home.dashboard.show", {
              name: entry.label,
            })}
            onClick={() =>
              onChange(
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
  );
}
