import "server-only";

import { getDockerProvider } from "@/lib/providers";
import { getString } from "@/lib/settings";

/**
 * M2.8 düzeltmesi — hedef container Caddy'den görünüyor mu?
 *
 * Yaşanmış olay: `pihole.myserver.local` kaydı hedef olarak `pihole` container
 * adıyla kuruldu; Caddy ile Pi-hole farklı Docker ağlarında olduğu için
 * (`server-panel_default` ↔ `pihole_default`) ad hiç çözülmedi. Panel bunu
 * söylemiyordu — `caddy.ts` içindeki yorum "ekranda uyarı gösteriliyor" dese
 * de öyle bir uyarı YOKTU. Kullanıcının bunu görebileceği tek yer Caddy
 * loglarıydı.
 *
 * Burada hesaplanan bilgi forma taşınıyor: hedef seçildiği anda uyarı çıkıyor
 * ve çözüm öneriliyor (IP:port kullan ya da Caddy'yi o ağa bağla).
 */

export type ContainerTarget = {
  name: string;
  /** Caddy ile ortak en az bir Docker ağı var mı. */
  reachable: boolean;
  /** Container'ın bağlı olduğu ağlar — uyarı metninde gösteriliyor. */
  networks: string[];
  /** Yayınlanmış portlar; kullanıcı IP:port'a geçerken hangisini yazacağını bilsin. */
  publishedPorts: number[];
};

export type ProxyTargets = {
  containers: ContainerTarget[];
  /** Caddy container'ının adı ve ağları; uyarı metni bunları anıyor. */
  caddyName: string;
  caddyNetworks: string[];
  /** Caddy container'ı hiç bulunamadıysa dolu — uyarı üretilmiyor, sebebi yazılıyor. */
  problem: string | null;
};

/**
 * Docker'a TEK çağrı yapılıyor: liste API'si hem ağları hem portları zaten
 * döndürüyor. Container başına `inspect`, yedi container'da yedi gidiş-dönüş
 * demekti (M2.5 kart keşfindeki aynı gerekçe).
 */
export async function proxyTargets(): Promise<ProxyTargets> {
  const caddyName = getString("proxy.caddy_container").trim() || "caddy";

  let containers;
  try {
    containers = await getDockerProvider().list(true);
  } catch (error) {
    return {
      containers: [],
      caddyName,
      caddyNetworks: [],
      problem: `Docker'a ulaşılamadı: ${error instanceof Error ? error.message : "bilinmeyen hata"}`,
    };
  }

  const caddy = containers.find((entry) => entry.name === caddyName);
  if (!caddy) {
    // Uyarı ÜRETİLMİYOR: Caddy'yi bulamadan "bu container erişilemez" demek,
    // doğru kurulmuş kayıtları da yanlışlıkla kırmızıya boyamak olurdu.
    return {
      containers: containers.map((entry) => ({
        name: entry.name,
        reachable: true,
        networks: entry.networks,
        publishedPorts: publishedPorts(entry.ports),
      })),
      caddyName,
      caddyNetworks: [],
      problem:
        `"${caddyName}" adlı container bulunamadı; hedeflerin erişilebilirliği ` +
        "denetlenemedi. Ayarlar → Yayınlama'daki container adını kontrol et.",
    };
  }

  const caddyNetworks = new Set(caddy.networks);

  return {
    containers: containers.map((entry) => ({
      name: entry.name,
      // Caddy'nin kendisi her zaman erişilebilir sayılıyor: kendine proxy
      // yapmak anlamsız ama uyarı göstermek de yanlış olurdu.
      reachable:
        entry.name === caddyName || entry.networks.some((net) => caddyNetworks.has(net)),
      networks: entry.networks,
      publishedPorts: publishedPorts(entry.ports),
    })),
    caddyName,
    caddyNetworks: caddy.networks,
    problem: null,
  };
}

function publishedPorts(ports: { hostPort: number | null }[]): number[] {
  return [...new Set(ports.map((port) => port.hostPort).filter((port): port is number => port !== null))].sort(
    (a, b) => a - b,
  );
}

export type Scheme = "http" | "https";

/**
 * Yayınlanan adreslerin taşıdığı port.
 *
 * Caddy 443'ü (ve 80'i) host'ta hangi porta bağladıysa kullanıcının tarayıcıya
 * yazması gereken port odur. İkisi de dağıtım parametresi (T9 dışı, .env'de) ve
 * panel onları zaten biliyor — ekranda portsuz bir adres göstermek, çalışmayan
 * bir bağlantı vermek demekti.
 *
 * ŞEMAYA GÖRE soruluyor ve sebebi somut bir hatadır: TLS'i kapalı bir kayıt
 * `http://alan.adı` olarak sunuluyor ama port her zaman HTTPS'inki okunuyordu,
 * yani ekranda `http://alan.adı:443` yazıyordu — hiçbir zaman bağlanamayacak
 * bir adres. Panel 443'te, yayınlar 80'de olduğu için ikisi ayrı değişken.
 */
export function publishedPort(scheme: Scheme = "https"): number {
  const fallback = scheme === "https" ? 443 : 80;
  const raw = Number(
    (scheme === "https" ? process.env.PANEL_HTTPS_PORT : process.env.PANEL_HTTP_PORT) ?? fallback,
  );
  return Number.isInteger(raw) && raw > 0 && raw < 65536 ? raw : fallback;
}

/** Şemanın kendi varsayılan portu — adreste gösterilmez. */
export function isDefaultPort(scheme: Scheme, port: number): boolean {
  return scheme === "https" ? port === 443 : port === 80;
}

/** Tam adres — port şemanın varsayılanıysa gizlenir. */
export function publicUrl(domain: string, tls: string): string {
  const scheme: Scheme = tls === "off" ? "http" : "https";
  const port = publishedPort(scheme);
  return `${scheme}://${domain}${isDefaultPort(scheme, port) ? "" : `:${port}`}`;
}
