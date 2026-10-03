"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Check, ChevronDown, Languages } from "lucide-react";
import { LOCALE_COOKIE } from "@/lib/i18n/locales";
import { useLocale, useT } from "@/lib/i18n/client";

export type LanguageOption = { code: string; name: string; draft: boolean };

/**
 * Üst çubuktaki kişisel dil seçici.
 *
 * Seçim tarayıcıya çerez olarak yazılıyor, panelin genel dili (Ayarlar →
 * Genel → Dil) değişmiyor: aynı paneli kullanan iki kişi farklı dilde
 * çalışabilir ve bunun için ayar düzenleme yetkisi gerekmez. "Varsayılan"
 * çerezi siler, genel dile döner.
 *
 * Yerel `<select>` değil: üst çubuktaki sunucu seçicisiyle aynı görünümde,
 * temaya uyan bir liste. Düğme yalnızca simge + dil kodunu gösteriyor — üst
 * çubukta yer dar ve dil adı listede zaten yazıyor.
 *
 * Sözlük kök layout'tan geldiği için dil değişimi bir sunucu yenilemesi
 * (`router.refresh`) ister; tam sayfa yüklemesi gerekmiyor.
 */
export function LanguageSelect({
  options,
  defaultCode,
  personal,
}: {
  options: LanguageOption[];
  defaultCode: string;
  /** Kişisel tercih; yoksa null (genel dil geçerli). */
  personal: string | null;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const defaultName = options.find((option) => option.code === defaultCode)?.name ?? defaultCode;

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

  function choose(code: string | null) {
    setOpen(false);
    if (code === personal) return;
    document.cookie =
      code === null
        ? `${LOCALE_COOKIE}=; path=/; max-age=0; samesite=lax`
        : `${LOCALE_COOKIE}=${code}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => router.refresh());
  }

  const item = (selected: boolean) =>
    `flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-canvas ${
      selected ? "font-medium" : ""
    }`;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={pending}
        title={t("shell.language.title")}
        onClick={() => setOpen((value) => !value)}
        className={`flex items-center gap-1 rounded-md border border-line px-2 py-1.5 text-subtle transition-colors hover:text-ink ${
          pending ? "opacity-60" : ""
        }`}
      >
        <Languages className="size-4 shrink-0" aria-hidden />
        <span className="sr-only">{t("shell.language.label")}</span>
        <span className="text-xs font-medium uppercase">{locale}</span>
        <ChevronDown
          className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-56 max-w-[calc(100vw-2rem)] rounded-md border border-line bg-surface p-1 shadow-lg">
          <ul role="listbox" aria-label={t("shell.language.label")}>
            <li role="option" aria-selected={personal === null}>
              <button type="button" onClick={() => choose(null)} className={item(personal === null)}>
                <span className="min-w-0 flex-1 truncate">
                  {t("shell.language.default", { name: defaultName })}
                </span>
                {personal === null && <Check className="size-4 shrink-0 text-brand" aria-hidden />}
              </button>
            </li>
            <li role="separator" className="my-1 border-t border-line" />
            {options.map((option) => {
              const selected = option.code === personal;
              return (
                <li key={option.code} role="option" aria-selected={selected}>
                  <button type="button" onClick={() => choose(option.code)} className={item(selected)}>
                    <span className="w-6 shrink-0 text-[11px] font-medium uppercase text-subtle">
                      {option.code}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{option.name}</span>
                    {option.draft && (
                      <span className="shrink-0 rounded bg-warn/15 px-1 text-[10px] text-warn">
                        {t("shell.language.draft")}
                      </span>
                    )}
                    {selected && <Check className="size-4 shrink-0 text-brand" aria-hidden />}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="border-t border-line px-2 pb-1 pt-1.5 text-[11px] text-subtle">
            {t("shell.language.hint")}
          </p>
        </div>
      )}
    </div>
  );
}
