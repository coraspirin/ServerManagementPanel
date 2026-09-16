import { requireSession } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/session";
import { activeTokenCount, listApiTokens } from "@/lib/auth/apitoken";
import { getBool, getNumber } from "@/lib/settings";
import { recoveryCodesLeft, totpEnabled } from "@/lib/auth/twofactor";
import { PasswordSection } from "@/components/account/PasswordSection";
import { TwoFactorSection } from "@/components/account/TwoFactorSection";
import { ApiTokenSection } from "@/components/account/ApiTokenSection";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

/**
 * Hesabım (M3.1). Her kullanıcı buraya girebilir — kendi parolası ve kendi
 * 2FA'sı için ayrıca bir izin aranmaz.
 */
export default async function AccountPage() {
  const session = await requireSession();
  const t = getT();

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-line bg-surface p-5">
        <h2 className="text-sm font-semibold">{session.user.displayName}</h2>
        <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr] sm:max-w-md">
          <dt className="text-subtle">{t("account.username")}</dt>
          <dd className="font-mono">{session.user.username}</dd>
          <dt className="text-subtle">{t("account.role")}</dt>
          <dd>{session.user.roleName}</dd>
          <dt className="text-subtle">{t("account.permissionCount")}</dt>
          <dd>{session.user.permissions.length}</dd>
        </dl>
      </section>

      <TwoFactorSection
        enabled={totpEnabled(session.user.id)}
        recoveryCodesLeft={recoveryCodesLeft(session.user.id)}
      />

      {/* api.manage bilerek ayrı bir izin: token 2FA'sız ve uzun ömürlü bir
          kimlik, bu yüzden basma yetkisi yöneticinin bilerek verdiği bir şey.
          İzni olmayan kullanıcı bölümü hiç görmez. */}
      {hasPermission(session.user, "api.manage") && (
        <ApiTokenSection
          apiEnabled={getBool("api.enabled")}
          initial={{
            tokens: listApiTokens({ userId: session.user.id }),
            canSeeAll: hasPermission(session.user, "users.manage"),
            activeCount: activeTokenCount(session.user.id),
            maxTokens: getNumber("api.max_tokens_per_user"),
            defaultTtlDays: getNumber("api.token_default_ttl_days"),
            // Seçilebilir izinler = kendi izinleri eksi hiç verilmeyecekler.
            // Asıl sınır sunucuda (/api/tokens POST); bu yalnızca arayüz.
            grantablePermissions: session.user.permissions.filter(
              (key) => key !== "docker.exec" && key !== "host.shell",
            ),
          }}
        />
      )}

      <PasswordSection />
    </div>
  );
}
