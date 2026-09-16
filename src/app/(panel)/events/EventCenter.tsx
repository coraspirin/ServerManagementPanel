"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { Bell, GitCommitVertical } from "lucide-react";
import type { ChannelStatus, EventRow } from "@/lib/alerts/types";
import type { TimelineResult } from "@/lib/timeline";
import { EventsScreen } from "./EventsScreen";
import { TimelineView } from "./TimelineView";

/**
 * M3.2 — olay merkezi.
 *
 * İki görünüm bir arada: "Olaylar" alarmların kendi listesi (kabul et, bildirim
 * kanalları, tekrar dene), "Zaman Çizelgesi" ise olayları değişiklik ve metrik
 * sıçramalarıyla birlikte gösterir. Ayrı sayfa yapılmadı çünkü ikisi arasında
 * gidip gelmek, ekranlar arasında gidip gelmekten çok daha sık.
 */
export function EventCenter({
  initialEvents,
  initialChannels,
  initialTimeline,
  canSeeAudit,
  canManage,
  canTest,
  refreshSeconds,
}: {
  initialEvents: EventRow[];
  initialChannels: ChannelStatus[];
  initialTimeline: TimelineResult;
  canSeeAudit: boolean;
  canManage: boolean;
  canTest: boolean;
  refreshSeconds: number;
}) {
  const t = useT();
  const [tab, setTab] = useState<"events" | "timeline">("events");

  const tabs = [
    { key: "events" as const, label: t("eventsScreen.tab.events"), icon: Bell },
    { key: "timeline" as const, label: t("eventsScreen.tab.timeline"), icon: GitCommitVertical },
  ];

  return (
    <div className="space-y-4">
      <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((entry) => {
          const Icon = entry.icon;
          return (
            <button
              key={entry.key}
              type="button"
              onClick={() => setTab(entry.key)}
              className={`-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${
                tab === entry.key
                  ? "border-brand font-medium text-brand"
                  : "border-transparent text-subtle hover:text-ink"
              }`}
            >
              <Icon className="size-4" aria-hidden />
              {entry.label}
            </button>
          );
        })}
      </div>

      {tab === "events" ? (
        <EventsScreen
          initialEvents={initialEvents}
          initialChannels={initialChannels}
          canManage={canManage}
          canTest={canTest}
          refreshSeconds={refreshSeconds}
        />
      ) : (
        <TimelineView initial={initialTimeline} canSeeAudit={canSeeAudit} />
      )}
    </div>
  );
}
