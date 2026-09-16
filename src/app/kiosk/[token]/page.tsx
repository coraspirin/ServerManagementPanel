import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AppTile } from "@/components/apps/AppTile";
import { Clock } from "@/components/home/Clock";
import { InternetIndicator } from "@/components/home/InternetIndicator";
import { KioskRefresh } from "@/components/home/KioskRefresh";
import { WeatherCard } from "@/components/home/WeatherCard";
import { appGroups } from "@/lib/apps/store";
import { verifyKioskToken } from "@/lib/home/kiosk";
import { internetStatus } from "@/lib/home/internet";
import { currentWeather } from "@/lib/home/weather";
import { getNumber, getString } from "@/lib/settings";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

/**
 * M2.7 — kiosk görünümü.
 *
 * Oturum YOK: yetkiyi adresteki token veriyor. Bu yüzden sayfa yalnızca
 * OKUR — düzenleme düğmesi, widget aksiyonu, yönetim bağlantısı hiç
 * çizilmiyor. Token ele geçse bile yapabileceği tek şey bu ekranı görmek.
 *
 * Panel kabuğunun (sol menü, üst çubuk) dışında duruyor: duvara asılı bir
 * ekranda gezinme menüsünün işlevi yok, yeri var.
 */
export default async function KioskPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Geçersiz token'da 404: "yanlış token" demek, doğru token'ın var olduğunu
  // ve denemeye değdiğini söylemek olurdu.
  if (!verifyKioskToken(token)) notFound();

  const host = ((await headers()).get("host") ?? "").trim();
  const browserHost = /^(\[[^\]]+\]|[^:]+)(?::\d+)?$/.exec(host)?.[1] ?? "";

  const [internet, weather] = await Promise.all([internetStatus(), currentWeather()]);
  const groups = appGroups(browserHost);
  const t = getT();

  return (
    <main className="min-h-dvh bg-canvas p-6 text-ink">
      <KioskRefresh seconds={getNumber("home.kiosk_refresh")} />

      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <Clock big />
          {weather.ok && (
            <WeatherCard weather={weather.weather} label={getString("home.location_label")} big />
          )}
        </div>

        <InternetIndicator status={internet} big />

        {groups.map((group) => {
          const cards = group.cards.filter((card) => card.enabled);
          if (cards.length === 0) return null;

          return (
            <section key={group.category?.id ?? "diger"}>
              <h2 className="mb-2 text-base font-semibold">
                {group.category?.name ?? t("common.uncategorized")}
              </h2>
              {/* Dokunmatik için daha az sütun: parmakla isabet ettirilecek
                  hedefler fare imlecinden büyük olmalı. */}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {cards.map((card) => (
                  <AppTile key={card.id} card={card} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
