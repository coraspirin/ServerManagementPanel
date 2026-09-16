import { CloudOff, Globe, TriangleAlert } from "lucide-react";
import type { InternetStatus } from "@/lib/home/internet";
import { getT } from "@/lib/i18n/server";

/**
 * M2.7 — ev halkı için büyük gösterge.
 *
 * Üç ayrı durum var ve üçü de farklı bir cevap gerektiriyor:
 *   - internet yok            → modem/hat sorunu, panelin yapabileceği bir şey yok
 *   - internet var, servis çökük → sunucuda bir sorun var
 *   - her şey çalışıyor        → sorun senin cihazında
 *
 * Bu ayrım yapılmasaydı ev halkı her arızada aynı şeyi görür ve her seferinde
 * aynı soruyu sorardı.
 */
export function InternetIndicator({
  status,
  big = false,
}: {
  status: InternetStatus;
  big?: boolean;
}) {
  const t = getT();
  const broken = status.servicesDown > 0;

  const view = !status.online
    ? {
        Icon: CloudOff,
        tone: "text-danger",
        ring: "border-danger/40 bg-danger/5",
        title: t("home.internet.offline"),
        detail: t("home.internet.offlineDetail"),
      }
    : broken
      ? {
          Icon: TriangleAlert,
          tone: "text-warn",
          ring: "border-warn/40 bg-warn/5",
          title: t("home.internet.degraded"),
          detail: t("home.internet.degradedDetail", { count: status.servicesDown }),
        }
      : {
          Icon: Globe,
          tone: "text-ok",
          ring: "border-ok/40 bg-ok/5",
          title: t("home.internet.ok"),
          detail:
            status.servicesTotal > 0
              ? t("home.internet.okDetail", { count: status.servicesTotal })
              : t("home.internet.okSimple"),
        };

  return (
    <div className={`flex items-center gap-4 rounded-lg border p-5 ${view.ring}`}>
      <view.Icon className={`shrink-0 ${view.tone} ${big ? "size-14" : "size-9"}`} aria-hidden />
      <div className="min-w-0">
        <div className={`font-semibold ${view.tone} ${big ? "text-3xl" : "text-lg"}`}>
          {view.title}
        </div>
        <p className={`text-subtle ${big ? "mt-1 text-base" : "text-sm"}`}>{view.detail}</p>
      </div>
    </div>
  );
}
