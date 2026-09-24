import { requireLocalPage } from "@/lib/hosts/request";
import { requirePermission } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/session";
import { failedLogins } from "@/lib/security/fail2ban";
import { storedForwards } from "@/lib/security/upnp";
import { latestScans } from "@/lib/security/vuln";
import { SecurityScreen } from "./SecurityScreen";

export const dynamic = "force-dynamic";

/**
 * Güvenlik ekranı (M3.7 + M3.8).
 *
 * Sayfa açılışında YALNIZCA veritabanından okunanlar geliyor. CVE taraması,
 * SSH denetimi ve UPnP sorgusu container açıyor ya da ağa çıkıyor — hepsi
 * kendi düğmesiyle, kullanıcı isteyince çalışıyor. Aksi halde ekran her
 * açılışta dakikalarca yüklenirdi.
 */
export default async function SecurityPage() {
  const session = await requirePermission("security.view");
  await requireLocalPage();

  return (
    <SecurityScreen
      initialScans={latestScans()}
      initialForwards={storedForwards()}
      initialFailedLogins={failedLogins()}
      canManage={hasPermission(session.user, "security.manage")}
    />
  );
}
