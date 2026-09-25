import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { describeDiscovery, mergeDiscovery, runDiscovery } from "@/lib/apps/discovery";
import { fanOut } from "@/lib/hosts/fanout";
import { activeHosts } from "@/lib/hosts/store";
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

  // Kartlar sunucuya bağlı: her etkin sunucu kendi bağlamında taranır.
  const outcomes = await fanOut(activeHosts(), () => runDiscovery());
  const failed = outcomes.find((outcome) => !outcome.ok);
  if (failed && !failed.ok && outcomes.every((outcome) => !outcome.ok)) throw new Error(failed.error);
  const result = mergeDiscovery(outcomes.flatMap((outcome) => (outcome.ok ? [outcome.value] : [])));
  // Bir sunucunun hatası sessizce yutulmasın: özet onu da söyler.
  const summary = [
    describeDiscovery(result),
    ...outcomes.flatMap((outcome) => (outcome.ok ? [] : [`${outcome.host.name}: ✖ ${outcome.error}`])),
  ].join(" · ");

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "apps.discover",
    detail: summary,
    result: "ok",
  });

  return Response.json({
    ok: true,
    summary,
    result,
    ...launcherPayload(request),
  });
}
