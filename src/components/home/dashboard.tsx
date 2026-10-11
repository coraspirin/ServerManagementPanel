import "server-only";

import { Info } from "lucide-react";
import { MaintenanceSection } from "@/components/maintenance/MaintenanceSection";
import { Clock } from "@/components/home/Clock";
import { InternetIndicator } from "@/components/home/InternetIndicator";
import { WeatherCard } from "@/components/home/WeatherCard";
import { BackupStatus } from "@/components/home/widgets/BackupStatus";
import { ContainerSummary } from "@/components/home/widgets/ContainerSummary";
import { FleetCard } from "@/components/home/widgets/FleetCard";
import { RecentEvents } from "@/components/home/widgets/RecentEvents";
import { ResourceCards } from "@/components/home/widgets/ResourceCards";
import { StatusStrip, type StatusItem } from "@/components/home/widgets/StatusStrip";
import { UptimeWidget } from "@/components/home/widgets/UptimeWidget";
import { WidgetCard } from "@/components/home/widgets/WidgetCard";
import { listEvents, unacknowledgedCount } from "@/lib/alerts/store";
import { hasPermission } from "@/lib/auth/session";
import type { SessionUser } from "@/lib/auth/types";
import { backupHealth, backupOverview } from "@/lib/backup/overview";
import { listRuns } from "@/lib/backup/store/runs";
import { RESOURCE_METRICS } from "@/lib/dashboard/catalog";
import type { WidgetPlacement } from "@/lib/dashboard/catalog";
import { layoutFor } from "@/lib/dashboard/store";
import { containerOverview, fleetOverview, type ContainerOverview, type FleetEntry } from "@/lib/dashboard/summary";
import { internetStatus, type InternetStatus } from "@/lib/home/internet";
import { currentWeather } from "@/lib/home/weather";
import { latestSnapshot } from "@/lib/metrics/collect";
import { diskForecasts } from "@/lib/metrics/forecast";
import { querySeriesForRange } from "@/lib/metrics/query";
import { monitorViews } from "@/lib/monitors/store";
import type { MonitorView } from "@/lib/monitors/types";
import { getSystemProvider } from "@/lib/providers";
import { getNumber, getString } from "@/lib/settings";
import { cachedImageUpdates } from "@/lib/updates";
import { isMockMode } from "@/lib/env";
import { formatBytes } from "@/lib/metrics/catalog";
import { formatPct, formatRelative, formatUptime } from "@/lib/i18n/format";
import { getActiveDictionary, getT } from "@/lib/i18n/server";

/**
 * Gösterge paneli widget'larının sunucuda üretimi (/panel).
 *
 * Widget'lar burada, SUNUCUDA render ediliyor ve hazır JSX olarak düzen
 * bileşenine geçiyor (M3.13).
 */
export async function buildDashboard({
  user,
  hostId,
}: {
  user: SessionUser;
  hostId: number;
}): Promise<{ layout: WidgetPlacement[]; widgets: Record<string, React.ReactNode> }> {
  const t = getT();
  const dict = getActiveDictionary();
  const layout = layoutFor(user.id, user.permissions);
  /*
    Yalnızca GÖRÜNÜR widget'ların verisi yükleniyor: gizlenmiş bir container
    özeti için uzak ajana istek atmanın anlamı yok. Durum şeridi diğer
    widget'ların verisini de kullandığı için o açıksa ilgili veriler yine
    yükleniyor — şerit kendi başına ayrı sorgular üretmesin diye paylaşılıyor.
  */
  const shown = new Set(layout.filter((entry) => entry.visible).map((entry) => entry.key));
  const strip = shown.has("status");
  const needs = (...keys: string[]) => keys.some((key) => shown.has(key));

  const can = {
    metrics: hasPermission(user, "metrics.view"),
    docker: hasPermission(user, "docker.view"),
    backup: hasPermission(user, "backup.manage"),
    hosts: hasPermission(user, "hosts.view"),
    ack: hasPermission(user, "monitors.manage"),
  };

  const thresholds = {
    cpuWarn: getNumber("alerts.cpu.warn"),
    cpuCrit: getNumber("alerts.cpu.crit"),
    ramWarn: getNumber("alerts.ram.warn"),
    ramCrit: getNumber("alerts.ram.crit"),
    diskWarn: getNumber("alerts.disk.warn"),
    diskCrit: getNumber("alerts.disk.crit"),
  };

  const wantInternet = needs("internet") || strip;
  const wantContainers = can.docker && (needs("containers") || strip);
  const wantMonitors = can.metrics && (needs("uptime") || strip);
  const wantFleet = can.hosts && (needs("fleet") || strip);

  const [internet, weather, system, containers] = await Promise.all([
    wantInternet ? internetStatus() : Promise.resolve(null),
    needs("clock") ? currentWeather() : Promise.resolve(null),
    needs("system") ? getSystemProvider().info() : Promise.resolve(null),
    wantContainers ? containerOverview() : Promise.resolve(null),
  ]);

  const monitors: MonitorView[] = wantMonitors ? monitorViews(30, { hostId }) : [];
  const fleet: FleetEntry[] = wantFleet ? fleetOverview() : [];
  const snapshot = can.metrics && (needs("resources") || strip) ? latestSnapshot() : null;
  const locationLabel = getString("home.location_label");

  const items = strip
    ? statusItems({ hostId, can, thresholds, snapshot, internet, containers, monitors, fleet })
    : [];

  /**
   * Widget'lar burada, SUNUCUDA render ediliyor ve hazır JSX olarak düzen
   * bileşenine geçiyor (M3.13). Canlı tazelenmesi gereken tek widget (kaynak
   * kartları) bir istemci bileşeni; o da ilk değerini buradan alıyor.
   * Gösterecek bir şeyi olmayan widget (tek sunuculu kurulumda filo) null —
   * ızgara onu atlıyor.
   */
  const widgets: Record<string, React.ReactNode> = {
    status: strip ? <StatusStrip items={items} /> : null,
    clock: (
      <section className="flex h-full flex-wrap items-center justify-between gap-4 rounded-lg border border-line bg-surface p-5">
        <Clock />
        {weather?.ok && <WeatherCard weather={weather.weather} label={locationLabel} />}
      </section>
    ),
    internet: internet ? <InternetIndicator status={internet} /> : null,
    system: system ? (
      <WidgetCard
        title={t("overview.system")}
        icon={Info}
        href="/host"
        linkLabel={t("dashboard.all")}
        aside={
          <span className="shrink-0 text-[11px] text-subtle">
            {isMockMode() ? t("overview.mockShort") : t("overview.liveShort")}
          </span>
        }
      >
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          {[
            { label: t("overview.fact.hostname"), value: system.hostname },
            { label: t("overview.fact.os"), value: system.osName ?? system.platform },
            { label: t("overview.fact.kernel"), value: `${system.release} · ${system.arch}` },
            { label: t("overview.fact.uptime"), value: formatUptime(system.uptimeSeconds, dict) },
            { label: t("overview.fact.cpu"), value: `${system.cpuModel} ×${system.cpuCount}` },
            { label: t("overview.fact.memory"), value: formatBytes(system.totalMemBytes) },
          ].map((fact) => (
            <div key={fact.label} className="min-w-0">
              <dt className="text-[11px] text-subtle">{fact.label}</dt>
              <dd className="truncate text-sm font-medium" title={fact.value}>
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      </WidgetCard>
    ) : null,
    resources:
      snapshot && needs("resources") ? (
        <ResourceCards
          initialSnapshot={snapshot}
          initialSeries={querySeriesForRange(RESOURCE_METRICS, "1h")}
          refreshSeconds={getNumber("general.ui_refresh_interval")}
          thresholds={thresholds}
          diskForecast={Object.fromEntries(diskForecasts().map((entry) => [entry.label, entry.daysToFull]))}
        />
      ) : null,
    fleet: fleet.length > 0 && needs("fleet") ? <FleetCard hosts={fleet} thresholds={thresholds} currentId={hostId} /> : null,
    events:
      can.metrics && needs("events") ? (
        <RecentEvents events={listEvents({ limit: 8, hostId })} canAck={can.ack} />
      ) : null,
    uptime: wantMonitors && needs("uptime") ? <UptimeWidget monitors={monitors} /> : null,
    containers: containers && needs("containers") ? <ContainerSummary overview={containers} /> : null,
    backups:
      can.backup && needs("backups") ? (
        <BackupStatus
          systems={backupOverview().systems}
          runs={listRuns({ limit: 5 }).runs}
          stale={backupStale()}
        />
      ) : null,
    maintenance: needs("maintenance") ? (
      <div id="maintenance">
        <MaintenanceSection canAct={hasPermission(user, "docker.action")} />
      </div>
    ) : null,
  };

  return { layout, widgets };
}

/** Etkin bir yedek sisteminin son yedeği başarısız ya da gecikmişse true. */
function backupStale(): boolean {
  return backupHealth().failing.length > 0;
}

/**
 * Durum şeridinin öğeleri. Her öğe yalnızca kullanıcının o alanı görme izni
 * varsa ekleniyor; şerit, izni olmayan bir ekranın varlığını sızdırmamalı.
 */
function statusItems(input: {
  hostId: number;
  can: { metrics: boolean; docker: boolean; backup: boolean; hosts: boolean };
  thresholds: { cpuCrit: number; ramCrit: number; diskWarn: number; diskCrit: number };
  snapshot: ReturnType<typeof latestSnapshot> | null;
  internet: InternetStatus | null;
  containers: ContainerOverview | null;
  monitors: MonitorView[];
  fleet: FleetEntry[];
}): StatusItem[] {
  const t = getT();
  const dict = getActiveDictionary();
  const items: StatusItem[] = [];
  const { can, thresholds, snapshot } = input;

  if (input.internet && !input.internet.online) {
    items.push({ key: "internet", tone: "danger", label: t("dashboard.status.offline"), href: "/network" });
  } else if (input.internet && input.internet.servicesDown > 0) {
    items.push({
      key: "services",
      tone: "warn",
      label: t("dashboard.status.servicesDown", { count: input.internet.servicesDown }),
      href: "/uptime",
    });
  }

  const offlineHosts = input.fleet.filter((host) => host.status !== "online").length;
  if (offlineHosts > 0) {
    items.push({
      key: "hosts",
      tone: "danger",
      label: t("dashboard.status.hostsOffline", { count: offlineHosts }),
      href: "/hosts",
    });
  }

  if (can.metrics) {
    const down = input.monitors.filter(
      (monitor) => monitor.enabled && monitor.status === "down" && !monitor.inMaintenance,
    ).length;
    if (down > 0) {
      items.push({ key: "monitors", tone: "danger", label: t("dashboard.status.monitorsDown", { count: down }), href: "/uptime" });
    }

    const pending = unacknowledgedCount(input.hostId);
    if (pending > 0) {
      items.push({ key: "events", tone: "warn", label: t("dashboard.status.events", { count: pending }), href: "/events" });
    }

    if (snapshot) {
      if (snapshot.cpuPct !== null && snapshot.cpuPct >= thresholds.cpuCrit) {
        items.push({ key: "cpu", tone: "danger", label: t("dashboard.status.cpu", { value: formatPct(snapshot.cpuPct, dict, 0) }), href: "/monitoring" });
      }
      if (snapshot.memUsedPct !== null && snapshot.memUsedPct >= thresholds.ramCrit) {
        items.push({ key: "ram", tone: "danger", label: t("dashboard.status.ram", { value: formatPct(snapshot.memUsedPct, dict, 0) }), href: "/monitoring" });
      }
      for (const disk of snapshot.disks) {
        if (disk.usedPct < thresholds.diskWarn) continue;
        items.push({
          key: `disk:${disk.mount}`,
          tone: disk.usedPct >= thresholds.diskCrit ? "danger" : "warn",
          label: t("dashboard.status.disk", { mount: disk.mount, value: formatPct(disk.usedPct, dict, 0) }),
          href: "/monitoring",
        });
      }
    }
  }

  if (can.docker && input.containers?.available) {
    const { troubled, stopped } = input.containers;
    if (troubled.length > 0) {
      items.push({ key: "troubled", tone: "danger", label: t("dashboard.status.troubled", { count: troubled.length }), href: "/docker" });
    }
    if (stopped > 0) {
      items.push({ key: "stopped", tone: "info", label: t("dashboard.status.stopped", { count: stopped }), href: "/docker" });
    }
    const updates = cachedImageUpdates()?.value.filter((update) => update.updateAvailable).length ?? 0;
    if (updates > 0) {
      items.push({ key: "updates", tone: "info", label: t("dashboard.status.updates", { count: updates }), href: "/panel#maintenance" });
    }
  }

  if (can.backup && backupHealth().configured > 0) {
    const last = backupHealth().lastSuccessAt;
    if (backupStale()) {
      items.push({
        key: "backup",
        tone: "warn",
        label:
          last === null
            ? t("dashboard.status.noBackup")
            : t("dashboard.status.backupOld", { when: formatRelative(last * 1000, dict) }),
        href: "/backup",
      });
    } else if (last !== null) {
      items.push({
        key: "backup",
        tone: "info",
        label: t("dashboard.status.backupOk", { when: formatRelative(last * 1000, dict) }),
        href: "/backup",
      });
    }
  }

  return items;
}
