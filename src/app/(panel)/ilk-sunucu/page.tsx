import Link from "next/link";
import { redirect } from "next/navigation";
import { ServerCog } from "lucide-react";
import { requireSession } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/session";
import { localMountPaths } from "@/lib/hosts/local-probe";
import { localAutoDisabled } from "@/lib/hosts/local-state";
import { resolvePageHost } from "@/lib/hosts/request";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

/**
 * "İlk sunucunu ekle" (kararlar.md D1). Etkin hiçbir sunucu yokken sunucu
 * isteyen her sayfa buraya yönlenir. Sunucu varsa genel bakışa döner.
 */
export default async function FirstHostPage() {
  const session = await requireSession();
  if (await resolvePageHost()) redirect("/panel");

  const t = getT();
  const canManage = hasPermission(session.user, "hosts.manage");
  const paths = localMountPaths();
  // Compose'a eklenecek satırlar — container içindeki yollar env ile
  // değiştirilmiş olabilir, sağ taraf ondan üretilir.
  const mountLines = [
    `- /var/run/docker.sock:${paths.docker}`,
    `- /proc:${paths.proc}:ro`,
    `- /:${paths.root}:ro,rslave`,
  ].join("\n");

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center rounded-lg border border-dashed border-line bg-surface px-6 py-12 text-center">
      <ServerCog className="size-8 text-brand" aria-hidden />
      <h2 className="mt-3 text-lg font-semibold">{t("firstHost.title")}</h2>
      <p className="mt-1.5 text-sm text-subtle">{t("firstHost.body")}</p>

      {canManage ? (
        <Link
          href="/hosts?ekle=1"
          className="mt-5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          {t("firstHost.add")}
        </Link>
      ) : (
        <p className="mt-5 text-sm">{t("firstHost.askAdmin")}</p>
      )}

      {localAutoDisabled() && (
        <div className="mt-8 w-full rounded-md border border-line bg-canvas p-4 text-left">
          <p className="text-sm font-medium">{t("firstHost.localTitle")}</p>
          <p className="mt-1 text-xs text-subtle">{t("firstHost.localBody")}</p>
          <pre className="mt-2 select-all overflow-x-auto rounded bg-surface p-2 font-mono text-xs">{mountLines}</pre>
          <p className="mt-2 text-xs text-subtle">{t("firstHost.localThen")}</p>
        </div>
      )}
    </div>
  );
}
