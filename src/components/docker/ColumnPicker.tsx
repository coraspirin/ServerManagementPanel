"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { Columns3 } from "lucide-react";

/**
 * Container tablosunun sütun seçicisi (M3.24).
 *
 * Docker'ın bir container hakkında verdiği veri, bir tabloya sığmayacak kadar
 * çok: image, IP, ağ modu, çalışma süresi, restart sayısı, ağ ve disk toplamı,
 * yığın adı… Hepsini birden göstermek — dockhand'in yaptığı gibi — satırları
 * okunamaz hâle getiriyor; hiçbirini göstermemek de bugünkü eksikliğimiz.
 *
 * Çözüm hangisinin görüneceğini KULLANICIYA bırakmak. Seçim `localStorage`'da
 * tutuluyor: kişisel bir görünüm tercihi, sunucunun ayarı değil — panelin
 * ayarlar tablosuna yazmak, iki kullanıcının birbirinin tablosunu değiştirmesi
 * demek olurdu.
 */

export type ColumnDef = { id: string; label: string; fixed?: boolean };

const STORAGE_KEY = "panel.docker.columns";

/*
 * `localStorage` bir DIŞ KAYNAK, React state'i değil — bu yüzden
 * `useSyncExternalStore` ile okunuyor.
 *
 * Alternatifler ikisi de kusurluydu: efektten `setState` React'in kuralını
 * ihlal ediyor, `useState` başlangıç değerinde okumak ise sunucu render'ıyla
 * uyuşmazlık üretiyor (sunucuda `window` yok). `getServerSnapshot` null
 * dönerek bu ikilemi çözüyor: sunucu varsayılanı çiziyor, istemci kayıtlı
 * seçimle devam ediyor.
 */
const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedIds: string[] | null = null;

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  // Başka sekmede değiştirilirse burası da güncellensin.
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

/** Aynı ham metin için AYNI dizi referansı döner; yoksa sonsuz render olur. */
function getSnapshot(): string[] | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Gizli sekme ya da site verisi kapalı: varsayılana düş.
    return null;
  }

  if (raw === cachedRaw) return cachedIds;
  cachedRaw = raw;

  try {
    const parsed = raw === null ? null : (JSON.parse(raw) as unknown);
    cachedIds = Array.isArray(parsed) ? parsed.map(String) : null;
  } catch {
    cachedIds = null;
  }
  return cachedIds;
}

function getServerSnapshot(): string[] | null {
  return null;
}

function store(ids: string[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Yazılamadıysa seçim yalnızca bu sekmede, bu oturumda geçerli olur.
  }
  cachedRaw = null; // sonraki okuma yeniden ayrıştırsın
  for (const listener of listeners) listener();
}

/**
 * Görünür sütun kümesi.
 *
 * Kayıtta bilinmeyen sütun kimlikleri süzülüyor: eski bir kayıt, kaldırılmış
 * bir sütunu diriltmemeli.
 */
export function useColumns(columns: ColumnDef[]) {
  const stored = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const varsayilan = useMemo(
    () => columns.filter((entry) => entry.fixed !== false).map((entry) => entry.id),
    [columns],
  );

  const visible = useMemo(() => {
    if (stored === null) return new Set(varsayilan);
    const gecerli = new Set(columns.map((entry) => entry.id));
    return new Set(stored.filter((id) => gecerli.has(id)));
  }, [stored, varsayilan, columns]);

  const toggle = useCallback(
    (id: string) => {
      const next = new Set(visible);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      store([...next]);
    },
    [visible],
  );

  const reset = useCallback(() => store(varsayilan), [varsayilan]);

  return { visible, toggle, reset };
}

export function ColumnPicker({
  columns,
  visible,
  onToggle,
  onReset,
}: {
  columns: ColumnDef[];
  visible: Set<string>;
  onToggle: (id: string) => void;
  onReset: () => void;
}) {
  return (
    <details className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-subtle transition-colors hover:text-ink">
        <Columns3 className="size-3.5" aria-hidden />
        Sütunlar
      </summary>

      <div className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-line bg-surface p-2 shadow-lg">
        <ul className="space-y-0.5">
          {columns.map((column) => (
            <li key={column.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-canvas">
                <input
                  type="checkbox"
                  checked={visible.has(column.id)}
                  onChange={() => onToggle(column.id)}
                  className="size-3.5 accent-[var(--brand)]"
                />
                {column.label}
              </label>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={onReset}
          className="mt-1.5 w-full rounded border border-line px-2 py-1 text-[11px] text-subtle transition-colors hover:text-ink"
        >
          Varsayılana dön
        </button>
      </div>
    </details>
  );
}
