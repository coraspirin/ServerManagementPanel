import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { requireSession } from "@/lib/auth/guard";
import { PATH_HEADER } from "@/lib/auth/types";
import { appVersion, isMockMode } from "@/lib/env";
import { HostProvider, type HostSummary } from "@/components/shell/HostContext";
import { resolvePageHost } from "@/lib/hosts/request";
import { listHosts } from "@/lib/hosts/store";
import { defaultLocale, personalLocale } from "@/lib/i18n/server";
import { availableLocales } from "@/locales";

export const dynamic = "force-dynamic";

/**
 * Etkin sunucu yokken de açılan sayfalar (kararlar.md D1): sunucu eklemek,
 * kullanıcı/rol, hesap, ayarlar, denetim, işler, güncelleme ve yetki
 * yönergesi. Geri kalan her sayfa "İlk sunucunu ekle"ye gider.
 */
const NO_HOST_PATHS = [
  "/ilk-sunucu",
  "/hosts",
  "/users",
  "/hesap",
  "/settings",
  "/audit",
  "/jobs",
  "/update",
  "/yetki-yok",
];

function allowedWithoutHost(path: string): boolean {
  return NO_HOST_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Korumalı alan. Oturum burada gerçekten doğrulanır (middleware yalnızca
 * çerez varlığına bakar, Edge runtime'da DB'ye erişemez).
 */
export default async function PanelLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await requireSession();

  // Bootstrap parolası değiştirilmeden panele girilmesin.
  if (session.user.mustChangePassword) {
    redirect("/login/parola");
  }

  // Seçici yalnızca etkin sunucuları listeler; devre dışı bir sunucuya
  // geçilemez (çözümleme de onları reddeder).
  const hosts: HostSummary[] = listHosts()
    .filter((host) => host.enabled)
    .map((host) => ({
      id: host.id,
      name: host.name,
      isLocal: host.isLocal,
      status: host.status,
      latencyMs: host.latencyMs,
      color: host.color,
    }));
  const current = await resolvePageHost();
  // Sayfaların kendisi de `pageHostId`/`withPageHost` ile yönlendirir (istemci
  // tarafı gezinmede layout yeniden çalışmaz); burası tam yüklemeyi yakalar.
  if (!current) {
    const path = (await headers()).get(PATH_HEADER) ?? "";
    if (path && !allowedWithoutHost(path)) redirect("/ilk-sunucu");
  }

  return (
    <HostProvider hosts={hosts} currentId={current?.id ?? null}>
      <AppShell
        mode={isMockMode() ? "mock" : "live"}
        version={appVersion()}
        user={{
          displayName: session.user.displayName,
          roleName: session.user.roleName,
          permissions: session.user.permissions,
        }}
        languages={{
          options: availableLocales().map(({ code, name, draft }) => ({ code, name, draft })),
          defaultCode: defaultLocale(),
          personal: personalLocale(),
        }}
      >
        {children}
      </AppShell>
    </HostProvider>
  );
}
