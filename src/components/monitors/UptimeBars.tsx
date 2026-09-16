"use client";

import type { UptimeDay } from "@/lib/monitors/types";
import { useFormat, useT } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/translate";

/**
 * Günlük kullanılabilirlik şeridi.
 *
 * Veri olmayan günler boş (gri) çizilir — "%100 çalıştı" ile "hiç ölçülmedi"
 * aynı şey değil ve yeni eklenen bir monitörde bunu karıştırmak yanıltıcı olur.
 */
function dayColor(day: UptimeDay): string {
  if (day.upPct === null) {
    return day.maintenanceSeconds > 0 ? "bg-brand/40" : "bg-line";
  }
  if (day.upPct >= 99.9) return "bg-ok";
  if (day.upPct >= 95) return "bg-warn";
  return "bg-danger";
}

function dayTitle(day: UptimeDay, t: TFunction, f: ReturnType<typeof useFormat>): string {
  const date = f.date(`${day.date}T00:00:00`, { day: "2-digit", month: "short" });

  if (day.upPct === null) {
    return day.maintenanceSeconds > 0
      ? t("uptimeBars.maintenance", { date })
      : t("uptimeBars.noData", { date });
  }

  const minutes = Math.round(day.downSeconds / 60);
  const down = minutes > 0 ? t("uptimeBars.downtime", { count: minutes }) : "";
  return `${date} · ${f.pct(day.upPct, 2)}${down}`;
}

export function UptimeBars({ days }: { days: UptimeDay[] }) {
  const t = useT();
  const f = useFormat();
  return (
    // 90 gün × en az 3px, dar telefonda satıra sığmıyor; taşarsa kırpmak yerine
    // kaydırılıyor — çubuklar daha da inceltilse okunamaz hale gelirdi.
    <div
      className="no-scrollbar flex h-6 items-stretch gap-px overflow-x-auto"
      aria-label={t("uptimeBars.aria")}
    >
      {days.map((day) => (
        <div
          key={day.date}
          title={dayTitle(day, t, f)}
          className={`min-w-[3px] flex-1 rounded-[1px] ${dayColor(day)}`}
        />
      ))}
    </div>
  );
}
