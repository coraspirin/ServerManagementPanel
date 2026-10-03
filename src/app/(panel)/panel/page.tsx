import { enterHost } from "@/lib/hosts/context";
import { pageHostId } from "@/lib/hosts/request";
import { AppSections, browserHost, buildDashboard } from "@/components/home/dashboard";
import { Clock } from "@/components/home/Clock";
import { DashboardGrid } from "@/components/home/DashboardGrid";
import { InternetIndicator } from "@/components/home/InternetIndicator";
import { QuickLinks } from "@/components/home/QuickLinks";
import { WeatherCard } from "@/components/home/WeatherCard";
import { appGroups } from "@/lib/apps/store";
import { requireSession } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/session";
import { bookmarkGroups } from "@/lib/home/bookmarks";
import { internetStatus } from "@/lib/home/internet";
import { currentWeather } from "@/lib/home/weather";
import { getString } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const session = await requireSession();
  const hostId = await pageHostId({ agent: true });
  enterHost(hostId);
  const user = session.user;

  // `panel.dashboard` yetkisi olmayan (varsayılanda 'izleyici' rolü) sade bir
  // sayfa görür. Rol ADINA bakmak yerine yetkiye bakmak, M3.1'de özel rol
  // tanımlayan kullanıcının bu davranışı da ayarlayabilmesini sağlıyor.
  const full = hasPermission(user, "panel.dashboard");

  if (!full) {
    const [host, internet, weather] = await Promise.all([
      browserHost(),
      internetStatus(),
      currentWeather(),
    ]);
    const apps = appGroups(host);
    // Sade görünüm DÜZENLENEBİLİR DEĞİL ve olmamalı: duvara asılı ekranı ya da
    // ev halkının hesabını kişiselleştirme kutularıyla doldurmak, o görünümün
    // varlık sebebine aykırı olurdu.
    return (
      <div className="space-y-6">
        <InternetIndicator status={internet} />

        <section className="flex flex-wrap items-center justify-between gap-6 rounded-lg border border-line bg-surface p-5">
          <Clock />
          {weather.ok && <WeatherCard weather={weather.weather} label={getString("home.location_label")} />}
        </section>

        <AppSections groups={apps} />
        <QuickLinks apps={apps} bookmarks={bookmarkGroups()} compact />
      </div>
    );
  }

  const { layout, widgets } = await buildDashboard({ user, hostId });
  return <DashboardGrid layout={layout} widgets={widgets} />;
}
