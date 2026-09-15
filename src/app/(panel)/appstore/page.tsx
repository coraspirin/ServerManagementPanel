import { redirect } from "next/navigation";

import { hasPermission } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/guard";

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

  if (!hasPermission(session.user, "docker.view")) {
    return (
      <div className="rounded-lg border border-warn/40 bg-surface px-5 py-4">
        <p className="text-sm font-medium text-warn">Compose yığınları taşındı</p>
        <p className="mt-1 text-xs text-subtle">
          Yığın yönetimi Docker ekranının <strong>Stack</strong> sekmesinde toplandı. O
          ekranı görebilmek için <code className="font-mono">docker.view</code> iznin
          olması gerekiyor; şu anki rolünde yok. Bir yöneticiden istemen gerekiyor.
        </p>
      </div>
    );
  }

  redirect("/docker?tab=stack");
}
