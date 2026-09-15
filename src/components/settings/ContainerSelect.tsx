"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import type { DockerOverview } from "@/lib/docker/types";

/**
 * Docker container adı seçicileri (M3.45).
 *
 * Üç ayrı ekranda aynı hata yaşanıyordu: container adı ELLE yazılıyor,
 * yazım hatası sessizce yutuluyordu. `proxy.caddy_container` yanlışsa
 * yapılandırma yazılıyor ama reload hiç çalışmıyor; `logs.sources` yanlışsa
 * log toplama o kaynağı sessizce atlıyor.
 *
 * Liste `/api/docker`den geliyor — panelin başka her yerde kullandığı uç.
 * `docker.view` izni yoksa (ya da Docker erişilemiyorsa) alan düz metin
 * kutusuna düşüyor: seçemediği için değeri hiç giremeyen bir kullanıcı,
 * yazım hatasından daha kötü.
 */

const inputClass =
  "w-full rounded-md border border-line bg-canvas px-2 py-1.5 text-sm outline-none focus:border-brand disabled:opacity-50";

/** Modül düzeyinde önbellek: aynı sayfada birden çok seçici olabiliyor. */
let cached: string[] | null = null;

export function useContainerNames(): { names: string[] | null; failed: boolean } {
  const [names, setNames] = useState<string[] | null>(cached);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (cached) return;
    const controller = new AbortController();

    (async () => {
      try {
        const response = await fetch("/api/docker", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          setFailed(true);
          return;
        }
        const payload = (await response.json()) as DockerOverview;
        cached = payload.containers
          .map((container) => container.name)
          .sort((a, b) => a.localeCompare(b, "tr"));
        setNames(cached);
      } catch (error) {
        if ((error as Error)?.name !== "AbortError") setFailed(true);
      }
    })();

    return () => controller.abort();
  }, []);

  return { names, failed };
}

/** Tek container adı (ör. Caddy container'ı). */
export function ContainerSelect({
  value,
  disabled,
  onCommit,
  allowEmpty = false,
}: {
  value: string;
  disabled: boolean;
  onCommit: (value: string) => void;
  allowEmpty?: boolean;
}) {
  const { names, failed } = useContainerNames();

  if (failed || (names && names.length === 0)) {
    return (
      <input
        value={value}
        disabled={disabled}
        onChange={(e) => onCommit(e.target.value)}
        className={`${inputClass} font-mono sm:w-56`}
      />
    );
  }

  if (!names) {
    return <span className={`${inputClass} text-subtle sm:w-56`}>yükleniyor…</span>;
  }

  // Kayıtlı ad listede yoksa seçenek olarak eklenir: container durdurulmuş
  // olabilir ya da henüz kurulmamış olabilir; select'in onu sessizce başka
  // bir container'a çevirmesi, reload'ın yanlış yere gitmesi demek.
  const known = names.includes(value);

  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onCommit(e.target.value)}
      className={`${inputClass} font-mono sm:w-56`}
    >
      {allowEmpty && <option value="">— seçilmedi —</option>}
      {!known && value !== "" && <option value={value}>{value} (listede yok)</option>}
      {names.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  );
}

/**
 * Çoklu container seçimi (ör. toplanacak log kaynakları).
 *
 * `<select multiple>` KULLANILMIYOR: Ctrl+tık ile çoklu seçim keşfedilmesi
 * güç, dokunmatikte neredeyse imkânsız ve yanlışlıkla tek tıkla tüm seçimi
 * silmek çok kolay. Onay kutusu listesi her ikisinde de doğru çalışıyor.
 *
 * Depolama biçimi değişmiyor: virgülle ayrılmış adlar.
 */
export function ContainerMultiSelect({
  value,
  disabled,
  onCommit,
  emptyMeans,
}: {
  value: string;
  disabled: boolean;
  onCommit: (value: string) => void;
  /** Hiçbiri seçilmediğinde ne olduğunu anlatan cümle. */
  emptyMeans?: string;
}) {
  const { names, failed } = useContainerNames();

  const selected = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (failed) {
    return (
      <input
        value={value}
        disabled={disabled}
        onChange={(e) => onCommit(e.target.value)}
        placeholder="virgülle ayrılmış adlar"
        className={`${inputClass} font-mono sm:w-72`}
      />
    );
  }

  if (!names) {
    return <span className={`${inputClass} text-subtle sm:w-72`}>yükleniyor…</span>;
  }

  // Listede olmayan seçili adlar korunuyor ve gösteriliyor: durmuş bir
  // container'ı listeden düşürmek, ayarı sessizce budamak olurdu.
  const extra = selected.filter((name) => !names.includes(name));
  const rows = [...names, ...extra];

  const toggle = (name: string) => {
    const next = selected.includes(name)
      ? selected.filter((entry) => entry !== name)
      : [...selected, name];
    onCommit(next.join(","));
  };

  return (
    <div className="w-full space-y-1.5 sm:w-72">
      <div className="max-h-52 overflow-y-auto rounded-md border border-line bg-canvas">
        {rows.length === 0 ? (
          <p className="px-3 py-3 text-xs text-subtle">Container bulunamadı.</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((name) => {
              const on = selected.includes(name);
              return (
                <li key={name}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => toggle(name)}
                    aria-pressed={on}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-line/40 disabled:opacity-50"
                  >
                    <span
                      className={`flex size-3.5 shrink-0 items-center justify-center rounded border ${
                        on ? "border-brand bg-brand text-white" : "border-line"
                      }`}
                      aria-hidden
                    >
                      {on && <Check className="size-2.5" />}
                    </span>
                    <span className="truncate font-mono text-xs">{name}</span>
                    {!names.includes(name) && (
                      <span className="ml-auto shrink-0 text-[10px] text-subtle">listede yok</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="text-[11px] text-subtle">
        {selected.length === 0
          ? (emptyMeans ?? "Hiçbiri seçili değil.")
          : `${selected.length} seçili`}
        {selected.length > 0 && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onCommit("")}
            className="ml-2 underline transition-colors hover:text-ink disabled:opacity-50"
          >
            temizle
          </button>
        )}
      </p>
    </div>
  );
}
