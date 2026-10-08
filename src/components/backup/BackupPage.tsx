"use client";

import { useCallback, useState } from "react";
import { Boxes, Database, History, LayoutDashboard, MapPin, Server } from "lucide-react";

import type { BackupOverview } from "@/lib/backup/overview";
import type { SystemCategory } from "@/lib/backup/types";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import { api, useLiveRuns } from "./client";
import { HistoryTab } from "./HistoryTab";
import { LocationsTab } from "./LocationsTab";
import { OverviewTab } from "./OverviewTab";
import { SetupWizard } from "./SetupWizard";
import { SystemTab } from "./SystemTab";

/**
 * Yedekleme ekranı — sekmeler: Genel Bakış · Docker · İşletim Sistemi ·
 * Veritabanı · Konumlar · Geçmiş. Canlı ilerleme tek SSE akışından gelir.
 */

type Tab = "overview" | SystemCategory | "locations" | "history";

const TABS: { id: Tab; label: MessageKey; icon: typeof Boxes }[] = [
  { id: "overview", label: "backup.tabs.overview", icon: LayoutDashboard },
  { id: "docker", label: "backup.category.docker", icon: Boxes },
  { id: "os", label: "backup.category.os", icon: Server },
  { id: "database", label: "backup.category.database", icon: Database },
  { id: "locations", label: "backup.tabs.locations", icon: MapPin },
  { id: "history", label: "backup.tabs.history", icon: History },
];

function normalizeTab(value: string): Tab {
  return (TABS.find((tab) => tab.id === value)?.id ?? "overview") as Tab;
}

export function BackupPage({
  initial,
  initialTab,
}: {
  initial: BackupOverview;
  initialTab: string;
}) {
  const t = useT();
  const [overview, setOverview] = useState(initial);
  const [tab, setTabState] = useState<Tab>(normalizeTab(initialTab));
  const [setupOpen, setSetupOpen] = useState(false);
  /** Sistem sekmeleri bir koşu bitince kendi verilerini tazelesin. */
  const [revision, setRevision] = useState(0);

  const refresh = useCallback(async () => {
    try {
      setOverview(await api<BackupOverview>("/api/backup"));
      setRevision((value) => value + 1);
    } catch {
      // Geçici hata: bir sonraki olayda yeniden denenir.
    }
  }, []);

  const live = useLiveRuns(() => void refresh());

  const setTab = (next: Tab) => {
    setTabState(next);
    const url = new URL(window.location.href);
    if (next === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  };

  const needsSetup = overview.repos.length === 0 || overview.systems.every((system) => !system.configured);

  return (
    <div className="space-y-5">
      <nav className="no-scrollbar flex overflow-x-auto border-b border-line" aria-label={t("backup.tabs.label")}>
        {TABS.map((entry) => {
          const Icon = entry.icon;
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              aria-current={tab === entry.id ? "page" : undefined}
              className={`-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${
                tab === entry.id ? "border-brand font-medium text-brand" : "border-transparent text-subtle hover:text-ink"
              }`}
            >
              <Icon className="size-4" aria-hidden />
              {t(entry.label)}
            </button>
          );
        })}
      </nav>

      {tab === "overview" && (
        <OverviewTab
          overview={overview}
          live={live}
          needsSetup={needsSetup}
          onSetup={() => setSetupOpen(true)}
          onOpen={(next) => setTab(next)}
          onChanged={refresh}
        />
      )}
      {(tab === "docker" || tab === "os" || tab === "database") && (
        <SystemTab
          key={tab}
          category={tab}
          status={overview.systems.find((system) => system.category === tab) ?? null}
          locations={overview.repos}
          live={live}
          revision={revision}
          onSetup={() => setSetupOpen(true)}
          onChanged={refresh}
        />
      )}
      {tab === "locations" && <LocationsTab locations={overview.repos} live={live} onChanged={refresh} />}
      {tab === "history" && <HistoryTab revision={revision} />}

      <SetupWizard
        open={setupOpen}
        locations={overview.repos}
        onClose={() => setSetupOpen(false)}
        onDone={() => {
          setSetupOpen(false);
          void refresh();
          setTab("overview");
        }}
      />
    </div>
  );
}
