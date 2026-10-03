"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Bell, Check, Server } from "lucide-react";
import { writeHostCookie } from "@/components/shell/HostSelector";
import type { FleetEntry } from "@/lib/dashboard/summary";
import { useDynamicT, useFormat, useT } from "@/lib/i18n/client";
import { TONE_BG, TONE_TEXT, WidgetCard, toneFor } from "./WidgetCard";

/**
 * Sunucular — çoklu sunucu kurulumunda tüm filonun tek bakışta özeti.
 *
 * Bir satıra tıklamak üst çubuktaki sunucu seçiciyle AYNI işi yapıyor:
 * çerez yazılıyor ve sayfa yenileniyor; ana bölge sunucu anahtarıyla
 * yeniden kurulduğu için bütün widget'lar o sunucuya geçer.
 *
 * Seçili sunucu `HostContext`ten değil prop'tan geliyor: kiosk ekranı panel
 * kabuğunun dışında, orada sağlayıcı yok. Kioskta (`readOnly`) satırlar
 * tıklanamaz — oturumsuz ekranda sunucu seçimi anlamsız.
 */

type Thresholds = { cpuWarn: number; cpuCrit: number; ramWarn: number; ramCrit: number; diskWarn: number; diskCrit: number };

const STATUS_DOT: Record<FleetEntry["status"], string> = {
  online: "bg-ok",
  offline: "bg-danger",
  incompatible: "bg-warn",
  pending: "bg-warn",
  unknown: "bg-line",
};

export function FleetCard({
  hosts,
  thresholds,
  currentId,
  readOnly = false,
}: {
  hosts: FleetEntry[];
  thresholds: Thresholds;
  currentId: number;
  readOnly?: boolean;
}) {
  const t = useT();
  const tk = useDynamicT();
  const f = useFormat();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function select(id: number) {
    if (readOnly || id === currentId) return;
    writeHostCookie(id);
    startTransition(() => router.refresh());
  }

  const online = hosts.filter((host) => host.status === "online").length;

  return (
    <WidgetCard
      title={t("dashboard.fleet.title")}
      icon={Server}
      href={readOnly ? undefined : "/hosts"}
      linkLabel={t("dashboard.fleet.manage")}
      aside={
        <span className="shrink-0 text-xs text-subtle">
          {t("dashboard.fleet.summary", { online, total: hosts.length })}
        </span>
      }
    >
      <ul className={`grid gap-2 sm:grid-cols-2 xl:grid-cols-3 ${pending ? "opacity-60" : ""}`}>
        {hosts.map((host) => {
          const selected = host.id === currentId;
          const up = host.status === "online";
          return (
            <li key={host.id}>
              <button
                type="button"
                disabled={pending || readOnly}
                onClick={() => select(host.id)}
                aria-pressed={selected}
                className={`flex w-full flex-col gap-2 rounded-md border px-3 py-2.5 text-left transition-colors disabled:cursor-default ${
                  readOnly ? "" : "hover:border-brand/50"
                } ${
                  selected ? "border-brand/60 bg-brand/5" : "border-line bg-canvas"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`size-2 shrink-0 rounded-full ${STATUS_DOT[host.status]}`} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{host.name}</span>
                  {host.pending > 0 && (
                    <span
                      title={t("dashboard.fleet.pending", { count: host.pending })}
                      className="flex items-center gap-1 rounded-full bg-warn/15 px-1.5 text-xs font-medium text-warn"
                    >
                      <Bell className="size-3" aria-hidden />
                      {host.pending}
                    </span>
                  )}
                  {selected && <Check className="size-4 shrink-0 text-brand" aria-label={t("dashboard.fleet.selected")} />}
                </div>
                {up ? (
                  <div className="grid grid-cols-3 gap-2">
                    <Meter label={t("dashboard.fleet.cpu")} value={host.cpuPct} tone={toneFor(host.cpuPct, thresholds.cpuWarn, thresholds.cpuCrit)} format={f.pct} />
                    <Meter label={t("dashboard.fleet.ram")} value={host.memUsedPct} tone={toneFor(host.memUsedPct, thresholds.ramWarn, thresholds.ramCrit)} format={f.pct} />
                    <Meter label={t("dashboard.fleet.disk")} value={host.diskPct} tone={toneFor(host.diskPct, thresholds.diskWarn, thresholds.diskCrit)} format={f.pct} />
                  </div>
                ) : (
                  <p className="text-xs text-subtle">
                    {tk(`hosts.status.${host.status}`)}
                    {host.lastSeen !== null &&
                      ` · ${t("dashboard.fleet.lastSeen", { when: f.relative(host.lastSeen * 1000) })}`}
                  </p>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </WidgetCard>
  );
}

function Meter({
  label,
  value,
  tone,
  format,
}: {
  label: string;
  value: number | null;
  tone: "ok" | "warn" | "danger";
  format: (value: number, digits?: number) => string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-1 text-[11px] text-subtle">
        <span>{label}</span>
        <span className={`tabular-nums ${tone === "ok" ? "text-ink" : TONE_TEXT[tone]}`}>
          {value === null ? "—" : format(value, 0)}
        </span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-line" aria-hidden>
        <div
          className={`h-full rounded-full ${tone === "ok" ? "bg-brand" : TONE_BG[tone]}`}
          style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%` }}
        />
      </div>
    </div>
  );
}
