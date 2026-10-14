import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { requireSession } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/session";
import { listPermissions, listRoles } from "@/lib/auth/users";
import { getActiveDictionary, getT } from "@/lib/i18n/server";
import { translateLoose } from "@/lib/i18n/translate";
import { featuresForPermission } from "@/lib/permissions/catalog";

export const dynamic = "force-dynamic";

/**
 * Yetki yönergesi (kararlar.md D6). `requirePermission` izin eksikse buraya
 * `?need=<izin>` ile yollar: eksik izin, açtığı ekranlar, bu izne sahip
 * roller ve users.manage sahibine rol düzenleme bağlantısı.
 */
export default async function PermissionDeniedPage({
  searchParams,
}: {
  searchParams: Promise<{ need?: string }>;
}) {
  const session = await requireSession();
  const t = getT();
  const dict = getActiveDictionary();
  const tk = (key: string) => translateLoose(dict, key);

  // `need` kullanıcı girdisi: yalnız gerçekten var olan bir izin gösterilir.
  const raw = (await searchParams).need ?? "";
  const permission = listPermissions().find((item) => item.key === raw) ?? null;
  const canEditRoles = hasPermission(session.user, "users.manage");
  const roles = permission ? listRoles().filter((role) => role.permissions.includes(permission.key)) : [];
  const features = permission ? featuresForPermission(permission.key) : [];

  return (
    <div className="mx-auto max-w-xl rounded-lg border border-line bg-surface px-6 py-8">
      <div className="flex flex-col items-center text-center">
        <ShieldAlert className="size-8 text-warn" aria-hidden />
        <h2 className="mt-3 text-lg font-semibold">{t("permissions.denied.title")}</h2>
        <p className="mt-1 text-sm text-subtle">{t("permissions.denied.yourRole", { role: session.user.roleName })}</p>
      </div>

      {permission ? (
        <div className="mt-6 space-y-5 text-sm">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-subtle">{t("permissions.denied.need")}</p>
            <p className="mt-1">
              <code className="rounded bg-canvas px-1.5 py-0.5 font-mono">{permission.key}</code>
              {permission.description && <span className="ml-2 text-subtle">{permission.description}</span>}
            </p>
          </div>

          {features.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-subtle">{t("permissions.denied.features")}</p>
              <ul className="mt-1 list-inside list-disc">
                {features.map((feature) => (
                  <li key={feature.key}>{tk(`permissions.feature.${feature.key}`)}</li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-subtle">{t("permissions.denied.roles")}</p>
            {roles.length === 0 ? (
              <p className="mt-1 text-subtle">{t("permissions.denied.noRoles")}</p>
            ) : (
              <ul className="mt-1 divide-y divide-line rounded-md border border-line">
                {roles.map((role) => (
                  <li key={role.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span>
                      <span className="font-medium">{role.name}</span>
                      <span className="ml-2 text-xs text-subtle">{t("permissions.denied.users", { count: role.userCount })}</span>
                    </span>
                    {canEditRoles && (
                      <Link href={`/users?tab=roles&role=${role.id}`} className="text-xs text-brand hover:underline">
                        {t("permissions.denied.editRole")}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-6 text-center text-sm">{t("permissions.denied.unknown")}</p>
      )}

      {!canEditRoles && <p className="mt-5 text-center text-xs text-subtle">{t("permissions.denied.askAdmin")}</p>}
      <div className="mt-6 text-center">
        <Link href="/panel" className="text-sm text-brand hover:underline">
          {t("permissions.denied.back")}
        </Link>
      </div>
    </div>
  );
}
