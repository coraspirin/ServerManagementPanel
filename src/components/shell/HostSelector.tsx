"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Check, ChevronDown, Server } from "lucide-react";
import { useDynamicT, useT } from "@/lib/i18n/client";
import { useHosts, type HostSummary } from "./HostContext";

const COOKIE = "panel_host";

function writeHostCookie(id: number) {
  document.cookie = `${COOKIE}=${id}; path=/; max-age=31536000; samesite=lax`;
}

const STATUS_DOT: Record<HostSummary["status"], string> = {
  online: "bg-ok",
  offline: "bg-danger",
  incompatible: "bg-warn",
  pending: "bg-warn",
  unknown: "bg-subtle",
};

/**
 * Üst bardaki sunucu seçici. Tek sunucuda hiç görünmez.
 *
 * Seçim çereze yazılır ve sayfa sunucuda yeniden çizilir (`router.refresh`):
 * ekranların ilk verisi server component'lerde hazırlanıyor, istemci tarafında
 * sunucu değiştirmek her ekranın kendi yükleme mantığını bilmeyi gerektirirdi.
 *
 * Yerel `<select>` bilerek kullanılmadı: açılan seçenek listesini tarayıcı
 * çiziyor, koyu temada açık zemin üstüne açık yazı çıkıyor ve durum noktası
 * gösterilemiyor.
 */
export function HostSelector() {
  const t = useT();
  const tk = useDynamicT();
  const router = useRouter();
  const { hosts, current, multi } = useHosts();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!multi) return null;

  function select(id: number) {
    setOpen(false);
    if (id === current.id) return;
    writeHostCookie(id);
    startTransition(() => router.refresh());
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={pending}
        title={t("shell.hostSelector.title")}
        onClick={() => setOpen((value) => !value)}
        className={`flex min-w-0 items-center gap-1.5 rounded-md border border-line px-2 py-1 text-sm hover:bg-canvas ${
          pending ? "opacity-60" : ""
        }`}
      >
        <Server className="size-4 shrink-0 text-subtle" aria-hidden />
        <span className={`size-2 shrink-0 rounded-full ${STATUS_DOT[current.status]}`} aria-hidden />
        <span className="sr-only">{t("shell.hostSelector.label")}</span>
        <span className="min-w-0 max-w-[10rem] truncate font-medium">{current.name}</span>
        <ChevronDown className={`size-4 shrink-0 text-subtle transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label={t("shell.hostSelector.label")}
          className="absolute left-0 z-50 mt-1 max-h-80 w-64 max-w-[calc(100vw-2rem)] overflow-auto rounded-md border border-line bg-surface p-1 shadow-lg"
        >
          {hosts.map((host) => {
            const selected = host.id === current.id;
            return (
              <li key={host.id} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => select(host.id)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-canvas ${
                    selected ? "font-medium" : ""
                  }`}
                >
                  <span className={`size-2 shrink-0 rounded-full ${STATUS_DOT[host.status]}`} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{host.name}</span>
                  {host.status !== "online" && (
                    <span className="shrink-0 text-xs text-subtle">{tk(`hosts.status.${host.status}`)}</span>
                  )}
                  {selected && <Check className="size-4 shrink-0 text-brand" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
