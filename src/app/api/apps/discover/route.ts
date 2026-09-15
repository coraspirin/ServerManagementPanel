import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { describeDiscovery, runDiscovery } from "@/lib/apps/discovery";
import { launcherPayload } from "../route";

export const dynamic = "force-dynamic";

/**
 * Etiket taramasını elle çalıştırır (M2.5).
 *
 * Zamanlanmış iş zaten var; bu uç "container'a etiketi yeni ekledim, hemen
 * görmek istiyorum" içindir — 10 dakika beklemek kabul edilebilir bir geri
 * bildirim süresi değil.
 *
 * `apps.discovery_enabled` ayarına BAKMIYOR: kullanıcı düğmeye basarak zaten
 * açık bir istekte bulundu. Ayar, arka planda kendiliğinden çalışmayı yönetir.
 */
export async function POST(request: Request) {
  const guard = await guardApi(request, "apps.manage");
  if (!guard.ok) return guard.response;

  const result = await runDiscovery();

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "apps.discover",
    detail: describeDiscovery(result),
    result: "ok",
  });

  return Response.json({
    ok: true,
    summary: describeDiscovery(result),
    result,
    ...launcherPayload(request),
  });
}
