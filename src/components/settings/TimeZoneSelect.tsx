"use client";

import { useId, useMemo, useState } from "react";
import { useFormat, useT } from "@/lib/i18n/client";
import { isValidTimeZone, supportedTimeZones } from "@/lib/time/zone";

const inputClass =
  "w-full rounded-md border border-line bg-canvas px-2 py-1.5 text-sm outline-none focus:border-brand disabled:opacity-50";

/**
 * Saat dilimi seçici (`general.timezone`). Liste 400'ü aşkın ad içerdiği için
 * düz `<select>` yerine aranabilir bir alan: yazdıkça öneri çıkar, yalnız
 * GEÇERLİ bir ad kaydedilir. Altında o dilimdeki şu anki saat görünür —
 * kullanıcı neyi seçtiğini sayıya bakarak doğrulayabilsin.
 */
export function TimeZoneSelect({
  value,
  disabled,
  onCommit,
}: {
  value: string;
  disabled: boolean;
  onCommit: (value: string) => void;
}) {
  const t = useT();
  const f = useFormat();
  const listId = useId();
  const zones = useMemo(() => supportedTimeZones(), []);
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setDraft(value);
  }

  const valid = isValidTimeZone(draft.trim());
  const browserZone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return null;
    }
  }, []);

  function commit() {
    const next = draft.trim();
    if (next !== value && isValidTimeZone(next)) onCommit(next);
  }

  return (
    <div className="w-full space-y-1 sm:w-72">
      <input
        value={draft}
        list={listId}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        placeholder="Europe/Istanbul"
        aria-invalid={!valid}
        className={`${inputClass} font-mono`}
      />
      <datalist id={listId}>
        {zones.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
      {valid ? (
        // Saat sunucu ve tarayıcıda farklı dakikaya düşebilir.
        <p className="text-xs text-subtle" suppressHydrationWarning>
          {t("settings.timezone.now", {
            time: f.dateTime(new Date(), {
              timeZone: draft.trim(),
              hour: "2-digit",
              minute: "2-digit",
              day: "2-digit",
              month: "short",
            }),
          })}
          {browserZone && browserZone !== draft.trim() ? (
            <>
              {" · "}
              <button
                type="button"
                disabled={disabled}
                className="underline underline-offset-2 hover:text-brand"
                onClick={() => {
                  setDraft(browserZone);
                  onCommit(browserZone);
                }}
              >
                {t("settings.timezone.useBrowser", { zone: browserZone })}
              </button>
            </>
          ) : null}
        </p>
      ) : (
        <p className="text-xs text-danger">{t("settings.timezone.invalid")}</p>
      )}
    </div>
  );
}
