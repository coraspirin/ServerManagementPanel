import "server-only";

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getDockerProvider } from "@/lib/providers";
import { serverT } from "@/lib/i18n/runtime";
import { getString } from "@/lib/settings";
import { listProxyHosts, type ProxyHost } from "./store";

/**
 * M2.8 — Caddy yapılandırması üretimi ve yeniden yükleme.
 *
 * Panel ANA Caddyfile'a hiç dokunmuyor: orada panelin kendi girişi tanımlı ve
 * panelin oraya yazdığı hatalı bir satır, panelin kendi ayağını kesmesi
 * demek olurdu. Bunun yerine ayrı bir dosya üretiliyor ve Caddyfile onu
 * `import` ediyor. Üretilen dosya bozuksa Caddy yeniden YÜKLENMEZ; eski
 * yapılandırma çalışmaya devam eder ve panel hatayı gösterir.
 */

const HEADER = `# ---------------------------------------------------------------------------
# BU DOSYA PANEL TARAFINDAN ÜRETİLİR — ELLE DÜZENLEME.
# Kaynak: panel veritabanındaki proxy_hosts tablosu (M2.8).
# Her değişiklikte baştan yazılır; buraya eklenen satırlar kaybolur.
# ---------------------------------------------------------------------------
`;

export function proxyDir(): string {
  return process.env.PROXY_CONFIG_DIR ?? "/app/proxy";
}

export function proxyFile(): string {
  return path.join(proxyDir(), "proxy.caddy");
}

/**
 * Hedef adres.
 *
 * Container hedefinde ADRES container adıdır: panel ve caddy aynı Docker
 * ağındaysa isim çözümlenir. Farklı ağdaysa çözümlenmez ve kullanıcı bunu
 * ancak Caddy loglarında görür — bu yüzden ekranda uyarı gösteriliyor.
 */
function upstream(host: ProxyHost): string {
  return `${host.target}:${host.port}`;
}

export function renderCaddyConfig(hosts: ProxyHost[] = listProxyHosts()): string {
  const blocks = hosts
    .filter((host) => host.enabled)
    .map((host) => {
      const lines: string[] = [];

      // `http://` öneki, TLS kapalıyken Caddy'nin otomatik HTTPS'e geçmesini
      // engelliyor; yoksa Caddy sertifika almaya çalışır ve başarısız olur.
      lines.push(`${host.tls === "off" ? "http://" : ""}${host.domain} {`);

      if (host.tls === "internal") lines.push("\ttls internal");

      lines.push("\tencode zstd gzip");
      lines.push(`\treverse_proxy ${upstream(host)} {`);
      lines.push("\t\theader_up X-Real-IP {remote_host}");
      if (host.websocket) {
        // Caddy 2'de WebSocket yükseltmesi zaten geçiyor; başlıkların açıkça
        // iletilmesi ise bazı uygulamaların (Home Assistant, Zigbee2MQTT)
        // origin denetimi için gerekiyor.
        lines.push("\t\theader_up Host {host}");
        lines.push("\t\theader_up X-Forwarded-Proto {scheme}");
      }
      lines.push("\t}");
      lines.push("}");

      return lines.join("\n");
    });

  return `${HEADER}\n${blocks.join("\n\n")}\n`;
}

export function writeCaddyConfig(hosts?: ProxyHost[]): string {
  const content = renderCaddyConfig(hosts);
  mkdirSync(proxyDir(), { recursive: true });
  writeFileSync(proxyFile(), content, "utf8");
  return content;
}

export function currentCaddyConfig(): string {
  try {
    return readFileSync(proxyFile(), "utf8");
  } catch {
    return "";
  }
}

export type ReloadResult = { ok: boolean; message: string };

/**
 * Caddy'yi yeniden yükler.
 *
 * Container'ı yeniden BAŞLATMIYORUZ: `caddy reload` açık bağlantıları
 * korur, restart hepsini düşürür — panelin kendisi de Caddy'nin arkasında
 * olduğu için kullanıcı her yayınlama değişikliğinde kendi oturumunu
 * kesintiye uğratırdı.
 *
 * Docker exec zaten M1.9'da yazılmıştı; burada onun tek seferlik (etkileşimsiz)
 * biçimi kullanılıyor.
 */
export async function reloadCaddy(): Promise<ReloadResult> {
  const container = getString("proxy.caddy_container").trim() || "caddy";

  try {
    const result = await getDockerProvider().runOnce(container, [
      "caddy",
      "reload",
      "--config",
      "/etc/caddy/Caddyfile",
    ]);

    if (result.exitCode === 0) return { ok: true, message: serverT("caddy.reloaded") };

    return {
      ok: false,
      message: serverT("caddy.rejected", {
        code: result.exitCode,
        output: result.output.slice(-800),
      }),
    };
  } catch (error) {
    return {
      ok: false,
      message: serverT("caddy.unreachable", {
        error: error instanceof Error ? error.message : String(error),
      }),
    };
  }
}

/**
 * Yaz + yükle.
 *
 * Yazma hatası İSTİSNA olarak yukarı taşınmıyor: kayıt veritabanına zaten
 * girdi ve isteğin 500 ile düşmesi kullanıcıya "hiçbir şey olmadı" izlenimi
 * verirdi. Oysa olan şey belli — kayıt var, devreye alınamadı — ve mesaj bunu
 * söylemeli. (Sunucuda yaşandı: named volume root'a aitti, panel yazamadı.)
 */
export async function applyProxyConfig(): Promise<ReloadResult> {
  try {
    writeCaddyConfig();
  } catch (error) {
    return {
      ok: false,
      message: serverT("caddy.writeFailed", {
        error: error instanceof Error ? error.message : String(error),
        dir: proxyDir(),
      }),
    };
  }
  return reloadCaddy();
}
