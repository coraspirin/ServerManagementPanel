"use client";

import { useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";
import {
  buildCron,
  describeCron,
  nextRuns,
  parseCron,
  type CronMode,
  type CronParts,
} from "@/lib/cron/friendly";
import { useDict, useFormat, useT } from "@/lib/i18n/client";
import { Rich } from "@/lib/i18n/rich";
import type { MessageKey } from "@/lib/i18n/translate";

/**
 * Zamanlama seçici.
 *
 * Kullanıcıya ham cron gösterilmez: sıklık seçilir, ilgili alanlar açılır,
 * altında ne anlama geldiği ve sonraki çalışmalar yazılır. Cron ifadesi
 * yalnızca depolama biçimidir; "Özel" modunda isteyen doğrudan yazabilir.
 */

const MODES: { value: CronMode; label: MessageKey }[] = [
  { value: "minutes", label: "cron.mode.minutes" },
  { value: "hourly", label: "cron.mode.hourly" },
  { value: "daily", label: "cron.mode.daily" },
  { value: "days", label: "cron.mode.days" },
  { value: "weekly", label: "cron.mode.weekly" },
  { value: "monthly", label: "cron.mode.monthly" },
  { value: "yearly", label: "cron.mode.yearly" },
  { value: "custom", label: "cron.mode.custom" },
];

/** "Belirli gün aralığında" için sunulan aralıklar. */
const DAY_STEPS = [2, 3, 5, 7, 10, 14, 15, 20, 30];

const selectClass =
  "rounded-md border border-line bg-canvas px-2 py-1.5 text-sm outline-none focus:border-brand disabled:opacity-50";

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function CronEditor({
  value,
  disabled,
  onCommit,
  allowCustom = true,
}: {
  value: string;
  disabled: boolean;
  onCommit: (expression: string) => void;
  /**
   * "Özel (cron)" seçeneği listede olsun mu.
   *
   * Host görevlerinde kapalı: kullanıcı ham `17 6 * * *` biçimini hiç görmek
   * istemiyor. Kapalıyken bile, ELDEKİ ifade sıklık seçicisine sığmıyorsa
   * seçenek geri gelir — aksi halde var olan bir görevi açmak onu sessizce
   * başka bir zamanlamaya çevirirdi.
   */
  allowCustom?: boolean;
}) {
  const t = useT();
  const dict = useDict();
  const f = useFormat();
  const [parts, setParts] = useState<CronParts>(() => parseCron(value));
  const [rawDraft, setRawDraft] = useState(value);

  // Dışarıdan değer değişirse (kaydetme sonrası, varsayılana dönüş) senkronla.
  // Effect yerine render sırasında ayarlama: React'in "prop değişince state
  // güncelleme" için önerdiği yol; fazladan bir render turu doğurmaz.
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue) {
    setSyncedValue(value);
    setParts(parseCron(value));
    setRawDraft(value);
  }

  const expression = parts.mode === "custom" ? rawDraft : buildCron(parts);
  const upcoming = useMemo(() => nextRuns(expression, 2), [expression]);

  const modes = allowCustom || parts.mode === "custom"
    ? MODES
    : MODES.filter((m) => m.value !== "custom");

  function update(patch: Partial<CronParts>) {
    const next = { ...parts, ...patch };
    setParts(next);
    if (next.mode !== "custom") onCommit(buildCron(next));
  }

  return (
    <div className="w-full max-w-sm space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={parts.mode}
          disabled={disabled}
          onChange={(e) => {
            const mode = e.target.value as CronMode;
            // Özel moda geçerken mevcut ifadeyi taşı ki sıfırdan yazılmasın.
            if (mode === "custom") {
              setRawDraft(expression);
              setParts({ ...parts, mode });
            } else {
              update({ mode });
            }
          }}
          className={selectClass}
        >
          {modes.map((m) => (
            <option key={m.value} value={m.value}>
              {t(m.label)}
            </option>
          ))}
        </select>

        {parts.mode === "minutes" && (
          <label className="flex items-center gap-1.5 text-sm">
            <span className="text-subtle">{t("cron.editor.every")}</span>
            <select
              value={parts.everyMinutes}
              disabled={disabled}
              onChange={(e) => update({ everyMinutes: Number(e.target.value) })}
              className={selectClass}
            >
              {[1, 2, 5, 10, 15, 20, 30].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span className="text-subtle">{t("cron.editor.minutesSuffix")}</span>
          </label>
        )}

        {parts.mode === "hourly" && (
          <label className="flex items-center gap-1.5 text-sm">
            <select
              value={parts.minute}
              disabled={disabled}
              onChange={(e) => update({ minute: Number(e.target.value) })}
              className={selectClass}
            >
              {range(0, 59).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span className="text-subtle">{t("cron.editor.minuteSuffix")}</span>
          </label>
        )}

        {parts.mode === "days" && (
          <label className="flex items-center gap-1.5 text-sm">
            <span className="text-subtle">{t("cron.editor.every")}</span>
            <select
              value={parts.everyDays}
              disabled={disabled}
              onChange={(e) => update({ everyDays: Number(e.target.value) })}
              className={selectClass}
            >
              {DAY_STEPS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span className="text-subtle">{t("cron.editor.daysSuffix")}</span>
          </label>
        )}

        {parts.mode === "yearly" && (
          <label className="flex items-center gap-1.5 text-sm">
            <select
              value={parts.month}
              disabled={disabled}
              onChange={(e) => update({ month: Number(e.target.value) })}
              className={selectClass}
            >
              {range(1, 12).map((month) => (
                <option key={month} value={month}>
                  {f.month(month)}
                </option>
              ))}
            </select>
            <select
              value={parts.monthday}
              disabled={disabled}
              onChange={(e) => update({ monthday: Number(e.target.value) })}
              className={selectClass}
            >
              {range(1, 28).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span className="text-subtle">{t("cron.editor.daySuffix")}</span>
          </label>
        )}

        {parts.mode === "weekly" && (
          <select
            value={parts.weekday}
            disabled={disabled}
            onChange={(e) => update({ weekday: Number(e.target.value) })}
            className={selectClass}
          >
            {range(0, 6).map((index) => (
              <option key={index} value={index}>
                {f.weekday(index)}
              </option>
            ))}
          </select>
        )}

        {parts.mode === "monthly" && (
          <label className="flex items-center gap-1.5 text-sm">
            <span className="text-subtle">{t("cron.editor.monthPrefix")}</span>
            <select
              value={parts.monthday}
              disabled={disabled}
              onChange={(e) => update({ monthday: Number(e.target.value) })}
              className={selectClass}
            >
              {range(1, 28).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span className="text-subtle">{t("cron.editor.daySuffix")}</span>
          </label>
        )}

        {(parts.mode === "daily" ||
          parts.mode === "days" ||
          parts.mode === "weekly" ||
          parts.mode === "monthly" ||
          parts.mode === "yearly") && (
          <div className="flex items-center gap-1">
            <select
              value={parts.hour}
              disabled={disabled}
              onChange={(e) => update({ hour: Number(e.target.value) })}
              className={selectClass}
            >
              {range(0, 23).map((n) => (
                <option key={n} value={n}>
                  {pad(n)}
                </option>
              ))}
            </select>
            <span className="text-subtle">:</span>
            <select
              value={parts.minute}
              disabled={disabled}
              onChange={(e) => update({ minute: Number(e.target.value) })}
              className={selectClass}
            >
              {range(0, 59).map((n) => (
                <option key={n} value={n}>
                  {pad(n)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {parts.mode === "custom" && (
        <div className="space-y-1">
          <input
            type="text"
            value={rawDraft}
            disabled={disabled}
            onChange={(e) => setRawDraft(e.target.value)}
            onBlur={() => {
              if (rawDraft.trim() !== value) onCommit(rawDraft.trim());
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setRawDraft(value);
            }}
            placeholder={t("cron.editor.placeholder")}
            className={`w-full font-mono ${selectClass}`}
          />
          <p className="text-[11px] text-subtle">
            <Rich
              text={t("cron.editor.help")}
              values={{ example: <code className="font-mono">30 2 * * 0</code> }}
            />
          </p>
        </div>
      )}

      <div className="flex items-start gap-1.5 text-xs">
        <CalendarClock className="mt-px size-3.5 shrink-0 text-subtle" aria-hidden />
        <div className="min-w-0">
          <p className="font-medium">{describeCron(expression, t, dict)}</p>
          {upcoming.length > 0 ? (
            <p className="text-subtle">
              {t("cron.editor.next", {
                list: upcoming
                  .map((d) =>
                    f.dateTime(d, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }),
                  )
                  .join(" · "),
              })}
            </p>
          ) : (
            <p className="text-danger">{t("cron.editor.never")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
