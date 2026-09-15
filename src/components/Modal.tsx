"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Basit modal — `<dialog>` üzerine kurulu.
 *
 * Tarayıcının kendi öğesi kullanılıyor çünkü odak tuzağı (focus trap), Esc ile
 * kapatma ve arka planın erişilemez olması bedava geliyor; elle yazılan bir
 * modal bunları neredeyse her zaman eksik yapar.
 *
 * ORTALAMA `globals.css`'teki `dialog { margin: auto }` kuralından geliyor,
 * tarayıcıdan bedava DEĞİL: Tailwind v4 preflight'ı margin'i evrensel
 * seçiciyle sıfırladığı için tarayıcının kendi kuralı ölüyor ve kutu sol üst
 * köşeye yapışıyor. Gerekçesi orada yazılı.
 *
 * `sm` altında alttan açılan bir yaprağa (bottom sheet) dönüşür: ortada duran
 * dar bir kutu yerine alta yaslanmış tam genişlik — hem başparmağa yakın hem
 * de klavye açılınca yukarı itilen alan doğal görünüyor. Bunun için `mt-auto`
 * + `mb-0` veriliyor; üstteki otomatik boşluk kutuyu aşağı itiyor. `m-0`
 * yazmak ortalamayı büsbütün kaldırırdı.
 */
export function Modal({
  open,
  title,
  onClose,
  children,
  wide = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        // Yalnızca arka plana (dialog öğesinin kendisine) tıklanırsa kapan.
        if (e.target === ref.current) onClose();
      }}
      className={`w-[calc(100%-2rem)] rounded-lg border border-line bg-surface p-0 text-ink backdrop:bg-black/40 max-sm:mb-0 max-sm:mt-auto max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none max-sm:rounded-t-2xl max-sm:border-x-0 max-sm:border-b-0 ${
        wide ? "max-w-3xl" : "max-w-lg"
      }`}
    >
      {open && (
        <div className="max-h-[85dvh] overflow-y-auto overscroll-contain">
          <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-line bg-surface px-5 py-3">
            <h2 className="min-w-0 truncate font-semibold">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Kapat"
              className="-mr-1 flex shrink-0 items-center justify-center rounded p-1 text-subtle transition-colors hover:text-ink"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}
