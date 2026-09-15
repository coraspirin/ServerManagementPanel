import { headers } from "next/headers";
import Link from "next/link";
import { MaintenanceSection } from "@/components/maintenance/MaintenanceSection";
import { AppTile } from "@/components/apps/AppTile";
import { Clock } from "@/components/home/Clock";
import { DashboardGrid } from "@/components/home/DashboardGrid";
import { InternetIndicator } from "@/components/home/InternetIndicator";
import { QuickLinks } from "@/components/home/QuickLinks";
import { WeatherCard } from "@/components/home/WeatherCard";
import { appGroups } from "@/lib/apps/store";
import type { AppGroup } from "@/lib/apps/types";
import { requireSession } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/session";
import { layoutFor } from "@/lib/dashboard/store";
import { bookmarkGroups } from "@/lib/home/bookmarks";
import { internetStatus } from "@/lib/home/internet";
import { currentWeather } from "@/lib/home/weather";
import { getSystemProvider } from "@/lib/providers";
import { getString } from "@/lib/settings";
import { isMockMode } from "@/lib/env";

export const dynamic = "force-dynamic";

function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  return `${gb.toFixed(1)} GB`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} gün ${hours} saat`;
  if (hours > 0) return `${hours} saat ${minutes} dk`;
  return `${minutes} dk`;
}

/** Kart adreslerindeki {host} yer tutucusu için (M2.5). */
async function browserHost(): Promise<string> {
  const host = ((await headers()).get("host") ?? "").trim();
  return /^(\[[^\]]+\]|[^:]+)(?::\d+)?$/.exec(host)?.[1] ?? "";
}

export default async function OverviewPage() {
  const session = await requireSession();

  // `panel.dashboard` yetkisi olmayan (varsayılanda 'izleyici' rolü) sade bir
  // sayfa görür. Rol ADINA bakmak yerine yetkiye bakmak, M3.1'de özel rol
  // tanımlayan kullanıcının bu davranışı da ayarlayabilmesini sağlıyor.
  const full = hasPermission(session.user, "panel.dashboard");

  const [host, internet, weather] = await Promise.all([
    browserHost(),
    internetStatus(),
    currentWeather(),
  ]);

  const apps = appGroups(host);
  const bookmarks = bookmarkGroups();
  const locationLabel = getString("home.location_label");

  if (!full) {
    // Sade görünüm DÜZENLENEBİLİR DEĞİL ve olmamalı: duvara asılı ekranı ya da
    // ev halkının hesabını kişiselleştirme kutularıyla doldurmak, o görünümün
    // varlık sebebine aykırı olurdu.
    return (
      <div className="space-y-6">
        <InternetIndicator status={internet} />

        <section className="flex flex-wrap items-center justify-between gap-6 rounded-lg border border-line bg-surface p-5">
          <Clock />
          {weather.ok && <WeatherCard weather={weather.weather} label={locationLabel} />}
        </section>

        <AppSections groups={apps} />
        <QuickLinks apps={apps} bookmarks={bookmarks} compact />
      </div>
    );
  }

  const system = await getSystemProvider().info();
  const facts: Array<{ label: string; value: string }> = [
    { label: "Sunucu adı", value: system.hostname },
    { label: "İşletim sistemi", value: system.osName ?? system.platform },
    { label: "Çekirdek", value: system.release },
    { label: "Mimari", value: system.arch },
    { label: "İşlemci", value: system.cpuModel },
    { label: "Çekirdek sayısı", value: `${system.cpuCount}` },
    { label: "Toplam bellek", value: formatBytes(system.totalMemBytes) },
    { label: "Çalışma süresi", value: formatUptime(system.uptimeSeconds) },
  ];

  /**
   * Widget'lar burada, SUNUCUDA render ediliyor ve hazır JSX olarak düzen
   * bileşenine geçiyor (M3.13). Alternatif — her widget'ı istemci bileşenine
   * çevirip kendi verisini çektirmek — altı yeni API ucu ve altı ayrı yükleme
   * durumu demekti; oysa kullanıcının değiştirdiği tek şey sıra ve görünürlük.
   */
  const widgets: Record<string, React.ReactNode> = {
    clock: (
      <section className="flex h-full flex-wrap items-center justify-between gap-4 rounded-lg border border-line bg-surface p-5">
        <Clock />
        {weather.ok && <WeatherCard weather={weather.weather} label={locationLabel} />}
      </section>
    ),
    internet: <InternetIndicator status={internet} />,
    quicklinks: <QuickLinks apps={apps} bookmarks={bookmarks} />,
    apps: <AppSections groups={apps} />,
    maintenance: <MaintenanceSection canAct={hasPermission(session.user, "docker.action")} />,
    system: (
      <section className="rounded-lg border border-line bg-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Sistem</h2>
          <span className="text-xs text-subtle">
            {isMockMode()
              ? "MOCK_MODE — veriler fixtures/system.json dosyasından"
              : "Canlı — node:os üzerinden"}
          </span>
        </div>

        <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {facts.map((fact) => (
            <div key={fact.label} className="min-w-0">
              <dt className="text-xs text-subtle">{fact.label}</dt>
              <dd className="truncate text-sm font-medium" title={fact.value}>
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    ),
  };

  return (
    <DashboardGrid
      layout={layoutFor(session.user.id, session.user.permissions)}
      widgets={widgets}
    />
  );
}

/** Kart ızgarası — ana sayfada salt okunur; yönetim Uygulamalar ekranında. */
function AppSections({ groups }: { groups: AppGroup[] }) {
  const total = groups.reduce((sum, group) => sum + group.cards.length, 0);

  if (total === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line bg-surface px-5 py-8 text-center text-sm text-subtle">
        Henüz uygulama kartı yok.{" "}
        <Link href="/apps" className="text-brand hover:underline">
          Uygulamalar
        </Link>{" "}
        ekranından ekleyebilirsin.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section key={group.category?.id ?? "diger"}>
          <h2 className="mb-2 text-sm font-semibold">{group.category?.name ?? "Diğer"}</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {group.cards
              .filter((card) => card.enabled)
              .map((card) => (
                <AppTile key={card.id} card={card} />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
