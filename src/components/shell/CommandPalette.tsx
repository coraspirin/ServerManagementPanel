"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Container,
  CornerDownLeft,
  ExternalLink,
  HeartPulse,
  LayoutGrid,
  Search,
  X,
  type LucideIcon,
} from "lucide-react";
import { fold } from "@/lib/text";
import { navGroups } from "@/lib/nav";
import type { PermissionKey } from "@/lib/auth/types";
import { useDynamicT, useT } from "@/lib/i18n/client";

/**
 * M3.13 — komut paleti (Ctrl+K / Cmd+K).
 *
 * İki kaynaktan besleniyor:
 *   1. SAYFALAR — `nav.ts`'ten, ağ isteği olmadan. Palet ilk tuşa basıldığı an
 *      kullanılabilir olmalı; en sık aranan şey zaten bir sayfadır.
 *   2. CANLI KAYITLAR — container/kart/monitör, `/api/palette`'ten. Yalnızca
 *      palet İLK KEZ açıldığında çekiliyor: her sayfa yüklemesinde container
 *      listesi istemek, hiç kullanılmayabilecek bir özellik için Docker'a
 *      sürekli soru sormak olurdu.
 *
 * Eşleşme diyakritiksiz: "olcum" yazınca "ölçüm" bulunuyor (M3.3'teki FTS5
 * tokenizer'ıyla aynı beklenti — Türkçe klavyeyle her zaman uğraşılmasın).
 */

type Entry = {
  id: string;
  label: string;
  hint: string;
  href: string;
  kind: "page" | "container" | "app" | "monitor";
  external: boolean;
};

const KIND_ICON: Record<Entry["kind"], LucideIcon> = {
  page: Search,
  container: Container,
  app: LayoutGrid,
  monitor: HeartPulse,
};

export function CommandPalette({ permissions }: { permissions: PermissionKey[] }) {
  const t = useT();
  const tk = useDynamicT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [live, setLive] = useState<Entry[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const kindLabel: Record<Entry["kind"], string> = {
    page: t("shell.palette.kind.page"),
    container: t("shell.palette.kind.container"),
    app: t("shell.palette.kind.app"),
    monitor: t("shell.palette.kind.monitor"),
  };

  /** Sayfalar — izne göre süzülmüş, ağ isteği yok. */
  const pages = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    for (const group of navGroups) {
      for (const item of group.items) {
        if (!permissions.includes(item.permission)) continue;
        out.push({
          id: `page:${item.href}`,
          label: tk(item.labelKey),
          hint: tk(group.titleKey),
          href: item.href,
          kind: "page",
          external: false,
        });
        for (const child of item.children ?? []) {
          if (!permissions.includes(child.permission)) continue;
          out.push({
            id: `page:${child.href}`,
            label: `${tk(item.labelKey)} · ${tk(child.labelKey)}`,
            hint: tk(group.titleKey),
            href: child.href,
            kind: "page",
            external: false,
          });
        }
      }
    }
    return out;
  }, [permissions, tk]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((previous) => !previous);
      }
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    if (live !== null) return;

    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/palette");
        const payload = (await response.json()) as { entries?: Entry[] };
        if (!cancelled) setLive(payload.entries ?? []);
      } catch {
        // Canlı kayıtlar gelmezse palet sayfalarla çalışmaya devam eder.
        if (!cancelled) setLive([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, live]);

  const results = useMemo(() => {
    const all = [...pages, ...(live ?? [])];
    const needle = fold(query.trim());
    if (!needle) return all.slice(0, 12);

    return all
      .map((entry) => {
        const label = fold(entry.label);
        const index = label.indexOf(needle);
        // Baştan eşleşme önce gelsin: "log" yazınca "Loglar" en üstte olmalı,
        // "Denetim Kayıtları" değil.
        const score = index === 0 ? 0 : index > 0 ? 1 : fold(entry.hint).includes(needle) ? 2 : -1;
        return { entry, score };
      })
      .filter((row) => row.score >= 0)
      .sort((a, b) => a.score - b.score || a.entry.label.length - b.entry.label.length)
      .slice(0, 20)
      .map((row) => row.entry);
  }, [pages, live, query]);

  // Seçili satır, sonuç listesi kısaldığında render sırasında kırpılıyor —
  // effect içinde setState çağırmak yerine. Aramayı daraltan her tuş vuruşu
  // ekstra bir render turu tetiklemesin (react-hooks/set-state-in-effect).
  const activeIndex = Math.min(active, Math.max(results.length - 1, 0));

  if (!open) return null;

  function choose(entry: Entry) {
    setOpen(false);
    setQuery("");
    if (entry.external) {
      window.open(entry.href, "_blank", "noopener,noreferrer");
    } else {
      router.push(entry.href);
    }
  }

  // Telefonda 12vh üst boşluk, açılan klavyeyle birlikte paleti iyice eziyordu;
  // dar ekranda palet en üste yaslanıyor.
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("shell.palette.label")}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-4 sm:pt-[12vh]"
      onClick={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-lg border border-line bg-surface shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search className="size-4 shrink-0 text-subtle" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive(Math.min(activeIndex + 1, results.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive(Math.max(activeIndex - 1, 0));
              } else if (event.key === "Enter" && results[activeIndex]) {
                event.preventDefault();
                choose(results[activeIndex]);
              }
            }}
            placeholder={t("shell.palette.placeholder")}
            className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-subtle"
          />
          <kbd className="hidden shrink-0 rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-subtle sm:block">
            ESC
          </kbd>
          {/* Esc tuşu olmayan cihazda kapatmanın tek yolu perdeye dokunmaktı;
              liste uzunken perde neredeyse görünmüyor. */}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("common.actions.close")}
            className="-mr-1 flex shrink-0 items-center justify-center rounded p-1 text-subtle transition-colors hover:text-ink sm:hidden"
          >
            <X className="size-4" />
          </button>
        </div>

        <ul className="max-h-[50dvh] overflow-y-auto overscroll-contain py-1">
          {results.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-subtle">
              {live === null ? t("shell.palette.emptyLoading") : t("shell.palette.empty")}
            </li>
          )}
          {results.map((entry, index) => {
            const Icon = KIND_ICON[entry.kind];
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(entry)}
                  className={`flex w-full items-center gap-3 px-4 py-2 text-left transition-colors ${
                    index === activeIndex ? "bg-brand/10" : ""
                  }`}
                >
                  <Icon className="size-4 shrink-0 text-subtle" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{entry.label}</span>
                    <span className="block truncate text-xs text-subtle">
                      {kindLabel[entry.kind]} · {entry.hint}
                    </span>
                  </span>
                  {entry.external ? (
                    <ExternalLink className="size-3.5 shrink-0 text-subtle" aria-hidden />
                  ) : (
                    index === activeIndex && (
                      <CornerDownLeft className="size-3.5 shrink-0 text-subtle" aria-hidden />
                    )
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
