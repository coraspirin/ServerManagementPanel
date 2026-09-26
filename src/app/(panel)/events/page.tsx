import { listEvents } from "@/lib/alerts/store";
import { requirePermission } from "@/lib/auth/guard";
import { enterHost } from "@/lib/hosts/context";
import { pageHostId } from "@/lib/hosts/request";
import { hasPermission } from "@/lib/auth/session";
import { channelStatuses } from "@/lib/notify";
import { getNumber } from "@/lib/settings";
import { timeline } from "@/lib/timeline";
import { EventCenter } from "./EventCenter";

export const dynamic = "force-dynamic";

/**
 * Olay merkezi (M1.3 + M3.2).
 *
 * İki soru bir arada cevaplanıyor: bir alarm üretildiğinde ne oldu ve bildirim
 * gitti mi — gitmediyse NEDEN gitmedi; ve aynı zaman şeridinde kim neyi
 * değiştirdi, metrikler ne zaman sıçradı.
 */
export default async function EventsPage() {
  const session = await requirePermission("metrics.view");
  const canSeeAudit = hasPermission(session.user, "audit.view");
  // Olaylar ve zaman çizelgesi seçili sunucununkiler.
  const hostId = await pageHostId({ agent: true });
  enterHost(hostId);

  return (
    <EventCenter
      initialEvents={listEvents({ limit: 200, hostId })}
      initialChannels={channelStatuses()}
      initialTimeline={timeline({
        kinds: canSeeAudit ? ["audit", "event", "spike"] : ["event", "spike"],
      })}
      canSeeAudit={canSeeAudit}
      canManage={hasPermission(session.user, "monitors.manage")}
      canTest={hasPermission(session.user, "settings.edit")}
      refreshSeconds={getNumber("general.ui_refresh_interval")}
    />
  );
}
