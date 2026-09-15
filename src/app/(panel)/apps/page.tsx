import { headers } from "next/headers";
import { containerOptions } from "@/lib/apps/containers";
import { appGroups, listCategories } from "@/lib/apps/store";
import { requirePermission } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/session";
import { bookmarkGroups } from "@/lib/home/bookmarks";
import { listKioskTokens } from "@/lib/home/kiosk";
import { listMonitors } from "@/lib/monitors/store";
import { getNumber } from "@/lib/settings";
import { widgetDefs } from "@/lib/widgets";
import { AppsScreen } from "./AppsScreen";

export const dynamic = "force-dynamic";

/** Uygulamalar ekranı (M2.1). */
export default async function AppsPage() {
  // Kartları görmek için `panel.view` yeterli; yönetim ayrı yetki (apps.manage).
  const session = await requirePermission("panel.view");
  const canManageKiosk = hasPermission(session.user, "kiosk.manage");

  // Kart adreslerindeki {host} yer tutucusu, kullanıcının paneli açtığı adrese
  // çözülüyor (M2.5). Portu düşürüyoruz: kart kendi portunu zaten taşıyor.
  const host = ((await headers()).get("host") ?? "").trim();
  const browserHost = /^(\[[^\]]+\]|[^:]+)(?::\d+)?$/.exec(host)?.[1] ?? "";

  return (
    <AppsScreen
      initialGroups={appGroups(browserHost)}
      initialCategories={listCategories()}
      monitors={listMonitors().map((monitor) => ({ id: monitor.id, name: monitor.name }))}
      // Kart formundaki container seçimi icin; Docker erişilemezse bos gelir
      // ve alan serbest metne düşer.
      containers={await containerOptions()}
      // Sağlayıcı kodu istemciye taşınmıyor; yalnızca tanımlar geçiyor (M2.6).
      widgets={widgetDefs()}
      bookmarks={bookmarkGroups()}
      kioskTokens={canManageKiosk ? listKioskTokens() : []}
      canManage={hasPermission(session.user, "apps.manage")}
      canManageKiosk={canManageKiosk}
      refreshSeconds={getNumber("general.ui_refresh_interval")}
    />
  );
}
