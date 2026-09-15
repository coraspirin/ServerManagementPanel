import "server-only";

import tls from "node:tls";
import { listProxyHosts, saveCertificate, type CertificateInfo } from "./store";

/**
 * M2.8 — sertifika bitiş takibi.
 *
 * Caddy'nin kendi depolama biçimini okumak yerine adrese TLS ile bağlanıp
 * SUNULAN sertifika okunuyor. İki kazancı var: sertifikayı kimin ürettiğinden
 * bağımsız çalışıyor (Caddy, elle konmuş bir dosya, öndeki başka bir proxy) ve
 * tarayıcının göreceği şeyle birebir aynı şeyi ölçüyor.
 */

const TIMEOUT_MS = 8_000;

export function inspectCertificate(
  host: string,
  port = 443,
): Promise<Omit<CertificateInfo, "checkedAt">> {
  return new Promise((resolve) => {
    const socket = tls.connect(
      {
        host,
        port,
        servername: host,
        // Doğrulama KAPALI çünkü ölçülen şey geçerlilik değil, BİTİŞ TARİHİ.
        // Self-signed ya da yerel CA'lı bir sertifikanın da ne zaman
        // biteceğini bilmek istiyoruz; doğrulama açık olsaydı bağlantı
        // kurulmadan düşer ve hiçbir bilgi alamazdık.
        rejectUnauthorized: false,
        timeout: TIMEOUT_MS,
      },
      () => {
        const cert = socket.getPeerCertificate();
        socket.destroy();

        if (!cert || !cert.valid_to) {
          resolve({ issuer: "", subject: "", notAfter: null, error: "sertifika okunamadı" });
          return;
        }

        // Node bu alanları çoklu değer geldiğinde dizi olarak veriyor
        // (aynı OID birden çok kez yazılabiliyor); ilkini almak yeterli.
        const first = (value: string | string[] | undefined): string =>
          Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

        resolve({
          issuer: first(cert.issuer?.O) || first(cert.issuer?.CN),
          subject: first(cert.subject?.CN),
          notAfter: Math.floor(Date.parse(cert.valid_to) / 1000),
          error: "",
        });
      },
    );

    const fail = (message: string) => {
      socket.destroy();
      resolve({ issuer: "", subject: "", notAfter: null, error: message });
    };

    socket.on("timeout", () => fail("zaman aşımı"));
    socket.on("error", (error) => fail(error.message));
  });
}

export type CertificateCheck = {
  checked: number;
  expiring: { domain: string; daysLeft: number }[];
  failed: string[];
};

/**
 * Yayınlanan tüm adreslerin sertifikalarını kontrol eder.
 *
 * `tls: off` olanlar atlanıyor: HTTPS sunmayan bir adreste sertifika aramak
 * her turda anlamsız bir hata üretirdi.
 */
export async function checkCertificates(warnDays: number): Promise<CertificateCheck> {
  const hosts = listProxyHosts().filter((host) => host.enabled && host.tls !== "off");
  const now = Math.floor(Date.now() / 1000);
  const result: CertificateCheck = { checked: 0, expiring: [], failed: [] };

  for (const host of hosts) {
    const info = await inspectCertificate(host.domain);
    saveCertificate(host.id, { ...info, checkedAt: now });
    result.checked++;

    if (info.error) {
      result.failed.push(`${host.domain}: ${info.error}`);
      continue;
    }

    if (info.notAfter !== null) {
      const daysLeft = Math.floor((info.notAfter - now) / 86400);
      if (daysLeft <= warnDays) result.expiring.push({ domain: host.domain, daysLeft });
    }
  }

  return result;
}
