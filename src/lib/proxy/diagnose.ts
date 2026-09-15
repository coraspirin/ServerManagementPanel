import "server-only";

import dns from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";
import { getDockerProvider } from "@/lib/providers";
import { getNumber, getString } from "@/lib/settings";
import type { ProxyHost } from "./store";
import { publishedPort, publicUrl } from "./reachability";

/**
 * M2.8 düzeltmesi — "Yayını sına".
 *
 * Bir yayınlama üç katmandan geçer ve üçü de sessizce düşebilir. Yaşanmış
 * olayda kullanıcının gördüğü tek şey tarayıcının "DNS adresi bulunamadı"
 * mesajıydı; hangisinin bozuk olduğunu anlamak dört ayrı komut gerektirdi
 * (nslookup, docker port, docker inspect, container içinden curl). Panel bu
 * dört şeyi zaten biliyor — o yüzden artık kendisi söylüyor.
 *
 * Adımlar SIRAYLA çalışır ve ilk düşen adımda durur: DNS çözülmüyorsa TLS'i
 * denemenin bir anlamı yok ve "iki hata birden" göstermek asıl sebebi gizler.
 */

/**
 * `unknown` bilerek var: panel container'ı ufw yüzünden host'un yayınlanan
 * portuna ulaşamayabiliyor (DEPLOY.md'de yazılı bir Docker/ufw davranışı,
 * panele özgü değil). Bu durumda "başarısız" demek YANLIŞ olurdu — tarayıcı
 * aynı adresi sorunsuz açıyor olabilir. Sınayamadığımız şeyi kırmızı
 * göstermek, teşhis aracının kendisine olan güveni yok eder.
 */
export type StepStatus = "ok" | "fail" | "skip" | "unknown";

export type DiagnoseStep = {
  key: "dns" | "connect" | "upstream";
  label: string;
  status: StepStatus;
  detail: string;
  /** Ne yapılacağı — yalnızca düşen adımda dolu. */
  hint: string | null;
};

export type DiagnoseResult = {
  domain: string;
  url: string;
  steps: DiagnoseStep[];
  ok: boolean;
};

function timeoutMs(): number {
  return Math.max(2, getNumber("proxy.diagnose_timeout_seconds")) * 1000;
}

/**
 * 1. adım — alan adı çözülüyor mu, hangi IP'ye?
 *
 * İKİ KEZ soruluyor ve sebebi önemli: panel container'ının kendi çözümleyicisi
 * Docker'ın gömülü DNS'i, o da genellikle genel çözümleyicilere (1.1.1.1,
 * 8.8.8.8) gider. Genel çözümleyiciler `myserver.local` gibi YEREL adları
 * bilmez. Yalnızca ona bakan bir sınama, tarayıcıda gayet çalışan bir adres
 * için "DNS bozuk" derdi — düzeltmeye çalıştığımız hatanın tam tersi.
 *
 * Bu yüzden ilk deneme başarısızsa LAN'ın DNS sunucusuna doğrudan soruluyor ve
 * cevabın NEREDEN geldiği her durumda yazılıyor.
 */
async function checkDns(
  domain: string,
  lanServer: string | null,
): Promise<{ step: DiagnoseStep; address: string | null }> {
  const label = "Alan adı çözümleme";

  try {
    const addresses = await dns.lookup(domain, { all: true });
    return {
      address: addresses[0]?.address ?? null,
      step: {
        key: "dns",
        label,
        status: "ok",
        detail: `${domain} → ${addresses.map((entry) => entry.address).join(", ")}`,
        hint: null,
      },
    };
  } catch {
    // Panelin kendi çözümleyicisi bulamadı; LAN'ın DNS'ine soralım.
  }

  if (lanServer) {
    try {
      const resolver = new dns.Resolver({ timeout: timeoutMs(), tries: 1 });
      resolver.setServers([lanServer]);
      const addresses = await resolver.resolve4(domain);
      return {
        address: addresses[0] ?? null,
        step: {
          key: "dns",
          label,
          status: "ok",
          detail:
            `${domain} → ${addresses.join(", ")} (${lanServer} üzerinden)\n` +
            "Panelin kendi çözümleyicisi bu adı bilmiyor — bu normaldir, container " +
            "genel DNS'e bakar. Tarayıcın yerel DNS sunucusunu kullandığı sürece sorun yok.",
          hint: null,
        },
      };
    } catch {
      // İkisi de bulamadı: kayıt gerçekten yok.
    }
  }

  return {
    address: null,
    step: {
      key: "dns",
      label,
      status: "fail",
      detail:
        `${domain} hiçbir IP'ye çözülmüyor` +
        (lanServer ? ` (${lanServer} da dahil denendi).` : "."),
      hint:
        "Tarayıcının 'DNS adresi bulunamadı' hatasının sebebi budur. Yerel DNS " +
        "sunucuna (ör. Pi-hole → Settings → Local DNS Records) bu adı sunucunun " +
        "IP'sine yönlendiren bir kayıt ekle. Alt alan adları TAM EŞLEŞMEDİR: " +
        "'myserver.local' kaydı 'pihole.myserver.local' için yeterli değildir.",
    },
  };
}

/**
 * 2. adım — yayınlanan porta TLS el sıkışması kuruluyor mu?
 *
 * Bağlantı, 1. adımda BULUNAN IP'ye kuruluyor; adı yeniden çözmeye
 * çalışmıyoruz. Sebebi ilk sürümde yaşandı: adım 1 adı LAN DNS'inden bulmuştu
 * ama adım 2 container'ın kendi çözümleyicisine gidip ENOTFOUND aldı ve zaten
 * çalışan bir yayını "bağlanamadı" diye raporladı. SNI ve Host yine ALAN ADI
 * olarak gidiyor — Caddy hangi siteyi sunacağını ondan biliyor.
 */
function checkConnect(domain: string, address: string, useTls: boolean): Promise<DiagnoseStep> {
  // Port ŞEMAYA göre: panel HTTPS'te (443) duruyor ama TLS'i kapalı bir yayın
  // 80'de sunuluyor. Tek port okunsaydı çalışan bir http kaydı 443'te
  // sınanır ve "bağlanamadı" diye raporlanırdı.
  const port = publishedPort(useTls ? "https" : "http");
  const portVar = useTls ? "PANEL_HTTPS_PORT" : "PANEL_HTTP_PORT";
  const curl = `curl -kI ${useTls ? "https" : "http"}://${domain}${
    (useTls && port === 443) || (!useTls && port === 80) ? "" : `:${port}`
  }/`;

  return new Promise((resolve) => {
    const done = (step: Omit<DiagnoseStep, "key" | "label">) =>
      resolve({ key: "connect", label: `Bağlantı (:${port})`, ...step });

    // `rejectUnauthorized: false` — `tls internal` kayıtlarında sertifika
    // Caddy'nin yerel CA'sından geliyor ve doğrulanamaz. Burada sorulan soru
    // "sertifika güvenilir mi" değil, "Caddy cevap veriyor mu".
    const socket = useTls
      ? tls.connect({ host: address, port, servername: domain, rejectUnauthorized: false })
      : net.createConnection({ host: address, port });

    const timer = setTimeout(() => {
      socket.destroy();
      done({
        status: "unknown",
        detail: `${domain} (${address}):${port} panel container'ından cevap vermedi.`,
        hint:
          "Bu ADIM SINANAMADI, yayın bozuk demek değil. Sunucuda ufw etkinken " +
          "container'dan host'un portlarına giden paketler düşürülür; bu, panele " +
          "özgü olmayan bilinen bir Docker/ufw davranışıdır. Kendi bilgisayarından " +
          `şunu dene: ${curl} — cevap geliyorsa yayın çalışıyordur.`,
      });
    }, timeoutMs());

    socket.on(useTls ? "secureConnect" : "connect", () => {
      clearTimeout(timer);
      const issuer =
        useTls && "getPeerCertificate" in socket
          ? (socket as tls.TLSSocket).getPeerCertificate()?.issuer?.CN
          : undefined;
      socket.destroy();
      done({
        status: "ok",
        detail: `${domain} (${address}):${port} cevap verdi${issuer ? ` · sertifika: ${issuer}` : ""}`,
        hint: null,
      });
    });

    socket.on("error", (error) => {
      clearTimeout(timer);
      socket.destroy();

      // Bağlantı REDDEDİLDİYSE o adreste gerçekten kimse yok — bu kesin bir
      // hatadır. Ulaşılamıyorsa (ağ/güvenlik duvarı) sonuç belirsizdir.
      const code = (error as NodeJS.ErrnoException).code ?? "";
      const refused = code === "ECONNREFUSED";

      done({
        status: refused ? "fail" : "unknown",
        detail: `${domain} (${address}):${port} bağlanamadı: ${error.message}`,
        hint: refused
          ? `O adreste ${port} portunu dinleyen kimse yok. Caddy ${
              useTls ? "443" : "80"
            }'i host'ta hangi porta bağladıysa adres o portu taşımalı; ` +
            `değiştirmek istersen .env içindeki ${portVar} değerini düzenle.`
          : `Bu adım sınanamadı (ağ ya da güvenlik duvarı engeli olabilir). Kendi ` +
            `bilgisayarından dene: ${curl}`,
      });
    });
  });
}

/** 3. adım — Caddy hedefe ulaşabiliyor mu? Soruyu CADDY'nin içinden soruyoruz. */
async function checkUpstream(host: ProxyHost): Promise<DiagnoseStep> {
  const caddyName = getString("proxy.caddy_container").trim() || "caddy";
  const target = `${host.target}:${host.port}`;
  const label = `Hedef (${target})`;

  try {
    // wget Caddy'nin alpine imajında var; curl yok. `-S` başlıkları stderr'e
    // yazar, `-O /dev/null` gövdeyi atar — yanıt kodu yeter.
    const result = await getDockerProvider().runOnce(caddyName, [
      "wget",
      "-q",
      "-S",
      "-T",
      String(Math.ceil(timeoutMs() / 1000)),
      "-O",
      "/dev/null",
      `http://${target}/`,
    ]);

    const status = result.output.match(/HTTP\/[\d.]+ (\d{3})/);
    if (status) {
      return {
        key: "upstream",
        label,
        status: "ok",
        detail: `Caddy içinden ${target} → HTTP ${status[1]}`,
        hint: null,
      };
    }

    return {
      key: "upstream",
      label,
      status: "fail",
      detail: `Caddy ${target} adresinden yanıt alamadı.\n${result.output.slice(-300)}`,
      hint:
        host.targetKind === "container"
          ? `"${host.target}" bir container adı. Caddy onu ancak AYNI Docker ağındaysa ` +
            "çözebilir. Hedefi sunucunun IP'si + yayınlanmış port olarak yaz " +
            "(ör. 192.168.61.114:8081) ya da Caddy'yi o container'ın ağına bağla."
          : "Hedef adres ya da port yanlış olabilir; container gerçekten o portu " +
            "dinliyor mu kontrol et.",
    };
  } catch (error) {
    return {
      key: "upstream",
      label,
      status: "fail",
      detail: `Caddy container'ında komut çalıştırılamadı: ${
        error instanceof Error ? error.message : "bilinmeyen hata"
      }`,
      hint: `Ayarlardaki Caddy container adı ("${caddyName}") doğru mu?`,
    };
  }
}

/**
 * Sınamada kullanılacak yerel DNS sunucusu.
 *
 * Ayarda belirtilmemişse, panele HANGİ ADRESTEN erişildiyse o kullanılıyor:
 * kullanıcı panele `192.168.61.114:5000` ile geldiyse tarayıcısı da o ağdadır
 * ve ev kurulumlarında yerel DNS neredeyse her zaman aynı makinededir. Ad
 * (IP değil) ise kullanılmıyor — çözemediğimiz bir adı DNS sunucusu olarak
 * kullanmanın anlamı yok.
 */
export function lanDnsServer(requestHost: string | null): string | null {
  const configured = getString("proxy.diagnose_dns_server").trim();
  if (configured) return configured;

  const bare = (requestHost ?? "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return net.isIP(bare) ? bare : null;
}

export async function diagnoseProxyHost(
  host: ProxyHost,
  lanServer: string | null = null,
): Promise<DiagnoseResult> {
  const steps: DiagnoseStep[] = [];
  const url = publicUrl(host.domain, host.tls);

  const { step: dnsStep, address } = await checkDns(host.domain, lanServer);
  steps.push(dnsStep);

  if (dnsStep.status !== "ok" || !address) {
    // Sonraki adımlar ATLANIYOR: adı çözemeden bağlanmayı denemek aynı hatayı
    // ikinci kez, daha anlaşılmaz bir kılıkta göstermek olurdu.
    steps.push({
      key: "connect",
      label: "Bağlantı",
      status: "skip",
      detail: "Alan adı çözülmediği için denenmedi.",
      hint: null,
    });
    steps.push({
      key: "upstream",
      label: "Hedef",
      status: "skip",
      detail: "Alan adı çözülmediği için denenmedi.",
      hint: null,
    });
    return { domain: host.domain, url, steps, ok: false };
  }

  steps.push(await checkConnect(host.domain, address, host.tls !== "off"));

  // Hedef denemesi bağlantıdan BAĞIMSIZ çalışıyor: dışarıdan erişim bozukken
  // bile "Caddy hedefi görüyor mu" sorusunun cevabı işe yarar.
  steps.push(await checkUpstream(host));

  return {
    domain: host.domain,
    url,
    steps,
    // `unknown` başarısızlık SAYILMIYOR: sınayamadığımız bir adım yüzünden
    // çalışan bir yayını "bozuk" ilan etmek yanlış olurdu.
    ok: steps.every((step) => step.status !== "fail"),
  };
}
