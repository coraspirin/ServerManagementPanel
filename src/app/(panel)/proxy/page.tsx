import { requirePermission } from "@/lib/auth/guard";
import { requireLocalPage } from "@/lib/hosts/request";
import { currentCaddyConfig } from "@/lib/proxy/caddy";
import { listDdnsRecords } from "@/lib/proxy/ddns";
import { proxyTargets, publishedPort } from "@/lib/proxy/reachability";
import { proxyHostViews, type TlsMode } from "@/lib/proxy/store";
import { getString } from "@/lib/settings";
import { ProxyScreen } from "./ProxyScreen";

export const dynamic = "force-dynamic";

/** Yayınlama & DDNS ekranı (M2.8). */
export default async function ProxyPage() {
  await requirePermission("proxy.manage");
  // Caddy panelin kendi sunucusunda: uzak sunucu seçiliyken bu ekran o
  // sunucuyu yönetiyormuş gibi görünmesin.
  await requireLocalPage();

  // Hedef listesi artık yalnızca adları değil ERİŞİLEBİLİRLİĞİ de taşıyor:
  // Caddy ile ortak ağı olmayan bir container adı `reverse_proxy` tarafından
  // çözülemez ve kullanıcı bunu ancak Caddy loglarında görürdü. Docker
  // erişilemezse ekran yine açılır — kullanıcı "ağdaki başka makine"
  // seçeneğiyle devam edebilir.
  const targets = await proxyTargets();

  return (
    <ProxyScreen
      initialHosts={proxyHostViews()}
      initialDdns={listDdnsRecords()}
      initialConfig={currentCaddyConfig()}
      targets={targets}
      // İKİ port da geçiyor: panel HTTPS'te (443) duruyor ama TLS'i kapalı
      // kayıtlar 80'de sunuluyor. Tek port geçildiğinde ekran o kayıtlar için
      // `http://alan.adı:443` gösteriyordu — bağlanamayacak bir adres.
      publishedPorts={{ http: publishedPort("http"), https: publishedPort("https") }}
      defaultTls={getString("proxy.default_tls") as TlsMode}
    />
  );
}
