import type { Metadata, Viewport } from "next";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n/client";
import { getDictionary } from "@/lib/i18n/runtime";
import { getLocale, getT } from "@/lib/i18n/server";

/**
 * Dil ayarı veritabanından okunuyor; sayfa önceden üretilirse kurulum anındaki
 * dile çakılı kalırdı. Panel zaten oturum arkasında, önbelleklenecek bir şey
 * yok.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = getT();
  return {
    title: t("common.appName"),
    description: t("common.appDescription"),
  };
}

/**
 * `viewportFit: "cover"` çentikli telefonlarda sayfayı ekranın tamamına
 * yayar; karşılığında güvenli alan boşluklarını (env(safe-area-inset-*))
 * bizim vermemiz gerekir — globals.css'teki `safe-*` yardımcıları bunun için.
 *
 * `maximumScale`/`userScalable` bilerek ayarlanmadı: yakınlaştırmayı kapatmak
 * görme güçlüğü olan kullanıcıyı paneli kullanamaz hale getirir. iOS'un
 * odaklanınca kendiliğinden yakınlaştırma davranışı, alanların en az 16px
 * yazıyla çizilmesiyle (yine globals.css) çözülüyor.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0e17" },
  ],
};

/**
 * Tema, boyamadan önce uygulanır — açılışta beyaz parlama olmasın diye.
 *
 * Önce KULLANICI TERCİHİ okunuyor (üstbardaki tema düğmesi bunu yazıyor),
 * yoksa işletim sisteminin tercihine düşülüyor. Sıra tersine olsaydı koyu
 * temayı kapatan kullanıcı her açılışta bir kare koyu ekran görürdü.
 *
 * Anahtar `ThemeToggle` ile aynı: `panel-theme`. Betik burada satır içi
 * duruyor çünkü işini React bağlanmadan ÖNCE yapması gerekiyor.
 */
const themeScript = `
try {
  var saved = null;
  try { saved = localStorage.getItem('panel-theme'); } catch (e) {}
  var dark = saved === 'dark' || saved === 'light'
    ? saved === 'dark'
    : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', dark);
} catch (e) {}
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = getLocale();

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="antialiased">
        {/*
          Sözlük prop olarak geçiyor: sağlayıcı iki dili birden içe aktarsaydı
          ikisinin tüm metni istemci paketine girerdi. Kök layout burada
          olduğu için giriş ve kiosk ekranları da kapsanıyor.
        */}
        <I18nProvider locale={locale} dict={getDictionary(locale)}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
