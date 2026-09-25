import { enterHost } from "@/lib/hosts/context";
import { pageHostId } from "@/lib/hosts/request";
import { redirect } from "next/navigation";

import { hasPermission } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/guard";
import { Rich } from "@/lib/i18n/rich";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

/**
 * Compose yığınları artık Docker ekranının Stack sekmesinde (M3.37).
 *
 * Sayfa SİLİNMEDİ, yönlendirmeye çevrildi: bu adres menüde aylardır duruyordu
 * ve kayıtlı bir bağlantının 404 vermesi, taşımanın kullanıcıya ödettiği
 * gereksiz bir bedel olurdu.
 *
 * ⚠️ İzin sırası burada önemli: yığın kurmak `apps.install`, Docker ekranını
 * görmek `docker.view`. İkisi ayrı izinler ve `apps.install` olup `docker.view`
 * olmayan bir rol Stack sekmesini AÇAMAZ. Böyle bir kullanıcıyı sessizce boş
 * bir sayfaya yönlendirmek yerine sebebini yazıyoruz.
 */
export default async function StacksPage() {
  const session = await requirePermission("apps.install");
  enterHost(await pageHostId({ agent: true }));

  if (!hasPermission(session.user, "docker.view")) {
    const t = getT();
    return (
      <div className="rounded-lg border border-warn/40 bg-surface px-5 py-4">
        <p className="text-sm font-medium text-warn">{t("stacksMoved.title")}</p>
        <p className="mt-1 text-xs text-subtle">
          <Rich
            text={t("stacksMoved.body")}
            values={{
              tab: <strong>{t("stacksMoved.tab")}</strong>,
              perm: <code className="font-mono">docker.view</code>,
            }}
          />
        </p>
      </div>
    );
  }

  redirect("/docker?tab=stack");
}
