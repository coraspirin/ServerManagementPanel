import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { requireSession } from "@/lib/auth/guard";
import { appVersion, isMockMode } from "@/lib/env";

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

  return (
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
  );
}
