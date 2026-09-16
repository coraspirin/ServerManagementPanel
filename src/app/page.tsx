import { headers } from "next/headers";
import Link from "next/link";
import { LayoutDashboard, LogIn, Server } from "lucide-react";
import { WelcomeTiles } from "@/components/welcome/WelcomeTiles";
import { unacknowledgedCount } from "@/lib/alerts/store";
import { publicAppGroups, welcomeAppGroups } from "@/lib/apps/store";
import { currentSession, hasPermission } from "@/lib/auth/session";
import { sanitizeRichText } from "@/lib/richtext";
import { getBool, getString } from "@/lib/settings";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

/**
 * Karşılama sayfası — kök adres, herkese açık.
 *
 * Ev halkının asıl işi Jellyfin'e gitmek; panel, isteyenin girdiği yer. Bu
 * yüzden kartlar giriş formunun eklentisi olmaktan çıkıp kök adrese taşındı,
 * giriş kendi sayfasına çekildi (sağ üstteki düğme).
 *
 * ⚠️ Bu sayfanın oturumsuz açılabilmesi `middleware.ts`teki `PUBLIC_EXACT`
 * listesine bağlı. Orada kök adresin ÖNEK listesine değil TAM EŞLEŞME
 * listesine yazılması şart — gerekçesi o dosyada yazılı.
 */
export default async function WelcomePage() {
  const session = await currentSession();
  const t = getT();

  // Kart adreslerindeki {host} yer tutucusu (M2.5) burada da çözülmeli: kart,
  // panelin açıldığı adrese bakmalı. Port düşürülüyor, kart kendi portunu
  // zaten taşıyor.
  const host = ((await headers()).get("host") ?? "").trim();
  const browserHost = /^(\[[^\]]+\]|[^:]+)(?::\d+)?$/.exec(host)?.[1] ?? "";

  /*
    İki ayrı yol, iki ayrı SELECT — hangi sütunun dışarı çıktığı her iki yolda
    da kendi sorgusuna sabitli.

    `apps.login_screen` YALNIZCA anonim yolu kapatıyor. O ayarın sorusu
    "dışarıya ne açılsın"; oturum açmış kullanıcının kendi kartlarını görmesini
    engellemesi anlamsız olurdu.
  */
  const groups = session
    ? welcomeAppGroups(browserHost)
    : getBool("apps.login_screen")
      ? publicAppGroups(browserHost)
      : [];

  // Duyuru ev halkına söylenecek bir şey, sunucu durumu değil — o yüzden
  // oturumlu/oturumsuz ayrımı yok. Boşsa şerit hiç çizilmiyor.
  const notice = getString("welcome.notice").trim();
  const noticeWarn = getString("welcome.notice_level") === "warn";

  /*
    Okunmamış olay sayısı: makine üretimi bilgi, yalnızca oturum açmış VE
    olayları görme izni olan kullanıcıya. `unacknowledgedCount()` kendi başına
    izin kontrolü yapmıyor, sınır burada.
  */
  const pending =
    session && hasPermission(session.user, "metrics.view") ? unacknowledgedCount() : 0;

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="sticky top-0 z-20 flex h-[var(--header-h)] shrink-0 items-center gap-3 border-b border-line bg-surface pl-4 pr-[max(1rem,env(safe-area-inset-right))] pt-[env(safe-area-inset-top)]">
        <Server className="size-5 shrink-0 text-brand" aria-hidden />
        <span className="truncate font-semibold tracking-tight">{t("welcome.brand")}</span>

        <div className="ml-auto shrink-0">
          {session ? (
            <Link
              href="/panel"
              className="flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand hover:text-brand"
            >
              <LayoutDashboard className="size-4" aria-hidden />
              {t("welcome.panel")}
              {pending > 0 && (
                <span
                  title={t("welcome.unread", { count: pending })}
                  className="rounded-full bg-warn/15 px-1.5 text-xs font-medium text-warn"
                >
                  {pending}
                </span>
              )}
            </Link>
          ) : (
            <Link
              href="/login"
              className="flex items-center gap-2 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              <LogIn className="size-4" aria-hidden />
              {t("welcome.login")}
            </Link>
          )}
        </div>
      </header>

      <main className="pad-main mx-auto w-full max-w-6xl flex-1">
        {notice && (
          /*
            Duyuru artık zengin metin (M3.45): kalın, liste ve bağlantı
            içerebiliyor. `dangerouslySetInnerHTML` panelin TEK kullanım
            yeri ve içerik iki kez temizlenmiş oluyor — kaydedilirken
            (`serializeValue`) ve burada, çizilmeden hemen önce. İkincisi
            eski kayıtlar ve elle düzenlenmiş veritabanları için: bu sayfayı
            oturum açmamış herkes görüyor.
          */
          <div
            className={`prose-notice mb-6 rounded-lg border px-4 py-3 text-sm ${
              noticeWarn
                ? "border-warn/40 bg-warn/10 text-warn"
                : "border-brand/40 bg-brand/5 text-ink"
            }`}
            dangerouslySetInnerHTML={{ __html: sanitizeRichText(notice) }}
          />
        )}

        {groups.length > 0 ? (
          <WelcomeTiles groups={groups} />
        ) : (
          <p className="rounded-lg border border-dashed border-line px-5 py-12 text-center text-sm text-subtle">
            {session
              ? t("welcome.noCardsUser")
              : t("welcome.noCardsGuest")}
          </p>
        )}
      </main>
    </div>
  );
}
