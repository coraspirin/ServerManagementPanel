import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { requireSession } from "@/lib/auth/guard";
import { appVersion, isMockMode } from "@/lib/env";
import { HostProvider, type HostSummary } from "@/components/shell/HostContext";
import { resolvePageHost } from "@/lib/hosts/request";
import { listHosts } from "@/lib/hosts/store";

export const dynamic = "force-dynamic";

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

  return (
    <HostProvider hosts={hosts} currentId={current.id}>
      <AppShell
        mode={isMockMode() ? "mock" : "live"}
        version={appVersion()}
        user={{
          displayName: session.user.displayName,
          roleName: session.user.roleName,
          permissions: session.user.permissions,
        }}
      >
        {children}
      </AppShell>
    </HostProvider>
  );
}
