import "server-only";

import http from "node:http";
import { isMockMode } from "@/lib/env";
import { loadFixture } from "@/lib/fixtures";
import { getNumber } from "@/lib/settings";

/**
 * M2.10 — Tailscale durumu.
 *
 * Veri, tailscaled'in **yerel API**'sinden okunuyor: soket üzerinden konuşulur,
 * kimlik gerektirmez ve tailnet'in tamamını değil bu düğümün gördüğünü verir.
 * Tailscale API'si (api.tailscale.com) daha fazlasını verirdi ama API anahtarı
 * ister; anahtar gerektirmeyen bir kaynak varken onu zorunlu kılmak yanlış
 * olurdu. (Anahtar isteyen alanlar — tag yönetimi, tailnet geneli cihaz
 * listesi — Faz 3'e kalıyor.)
 *
 * ⚠️ Soket `srw-rw-rw-` yani host'ta herkese açık; ama panel container'ına
 *    SALT-OKUNUR mount ediliyor ve bu modül yalnızca GET yapıyor. tailscaled'i
 *    durdurmak/başlatmak gibi işlemler bilerek dışarıda: bunlar sistem
 *    düzeyinde kararlar ve yerleri host-helper'ın izin listesi (T4).
 */

const SOCKET_PATH = process.env.TAILSCALE_SOCKET ?? "/run/tailscale/tailscaled.sock";
const TIMEOUT_MS = 5_000;

export type Peer = {
  id: string;
  hostname: string;
  dnsName: string;
  os: string;
  ip: string;
  online: boolean;
  lastSeen: number | null;
  /** true = doğrudan bağlantı, false = DERP röle üzerinden. */
  direct: boolean;
  relay: string;
  exitNode: boolean;
  /** Bu düğüm ağ yönlendiricisi mi (LAN'ı tailnet'e tanıtıyor mu). */
  subnetRouter: boolean;
  keyExpiry: number | null;
  daysToExpiry: number | null;
  keyExpiryDisabled: boolean;
};

export type TailscaleStatus = {
  available: boolean;
  /** Erişilemiyorsa sebebi — kullanıcı ne yapacağını bilsin. */
  error: string | null;
  version: string;
  backendState: string;
  self: Peer | null;
  peers: Peer[];
  magicDns: string;
  /** Anahtarı yakında dolacak düğümler (self dahil). */
  expiring: Peer[];
};

type RawPeer = {
  ID?: string;
  HostName?: string;
  DNSName?: string;
  OS?: string;
  TailscaleIPs?: string[];
  Online?: boolean;
  LastSeen?: string;
  Relay?: string;
  CurAddr?: string;
  ExitNode?: boolean;
  ExitNodeOption?: boolean;
  PrimaryRoutes?: string[] | null;
  KeyExpiry?: string;
};

type RawStatus = {
  Version?: string;
  BackendState?: string;
  MagicDNSSuffix?: string;
  Self?: RawPeer;
  Peer?: Record<string, RawPeer>;
};

function request(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: SOCKET_PATH,
        path,
        method: "GET",
        timeout: TIMEOUT_MS,
        // tailscaled Host başlığını denetliyor; olmadan 403 döner.
        headers: { Host: "local-tailscaled.sock" },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`tailscaled HTTP ${res.statusCode}`));
            return;
          }
          resolve(body);
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("tailscaled yanıt vermedi")));
    req.on("error", reject);
    req.end();
  });
}

function toPeer(raw: RawPeer, now: number): Peer {
  const keyExpiry = raw.KeyExpiry ? Math.floor(Date.parse(raw.KeyExpiry) / 1000) : null;

  return {
    id: raw.ID ?? "",
    hostname: raw.HostName ?? "",
    // Sondaki nokta atılıyor: DNS'in kanonik biçimi ama ekranda gereksiz.
    dnsName: (raw.DNSName ?? "").replace(/\.$/, ""),
    os: raw.OS ?? "",
    ip: raw.TailscaleIPs?.[0] ?? "",
    online: raw.Online === true,
    lastSeen: raw.LastSeen ? Math.floor(Date.parse(raw.LastSeen) / 1000) : null,
    // `CurAddr` doluysa doğrudan uç-uca bağlantı var; boşsa trafik DERP
    // rölesinden geçiyor demektir ve gecikme belirgin şekilde artar.
    direct: Boolean(raw.CurAddr),
    relay: raw.Relay ?? "",
    exitNode: raw.ExitNode === true || raw.ExitNodeOption === true,
    subnetRouter: (raw.PrimaryRoutes?.length ?? 0) > 0,
    keyExpiry,
    daysToExpiry: keyExpiry === null ? null : Math.floor((keyExpiry - now) / 86400),
    // Anahtar süresi kapatılmış düğümlerde alan hiç gelmiyor.
    keyExpiryDisabled: keyExpiry === null,
  };
}

export async function tailscaleStatus(): Promise<TailscaleStatus> {
  const now = Math.floor(Date.now() / 1000);
  const empty: TailscaleStatus = {
    available: false,
    error: null,
    version: "",
    backendState: "",
    self: null,
    peers: [],
    magicDns: "",
    expiring: [],
  };

  let raw: RawStatus;
  try {
    raw = isMockMode()
      ? await loadFixture<RawStatus>("tailscale")
      : (JSON.parse(await request("/localapi/v0/status")) as RawStatus);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...empty,
      error:
        message.includes("ENOENT") || message.includes("ECONNREFUSED")
          ? "tailscaled soketi bulunamadı. Sunucuda Tailscale kurulu değilse bu bölüm boş kalır; kuruluysa docker-compose.yml içindeki soket mount'unun açık olması gerekir."
          : message,
    };
  }

  const self = raw.Self ? toPeer(raw.Self, now) : null;
  const peers = Object.values(raw.Peer ?? {})
    .map((peer) => toPeer(peer, now))
    .sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.hostname.localeCompare(b.hostname, "tr");
    });

  const warnDays = getNumber("tailscale.key_warn_days");
  const expiring = [...(self ? [self] : []), ...peers].filter(
    (peer) => peer.daysToExpiry !== null && peer.daysToExpiry <= warnDays,
  );

  return {
    available: true,
    error: null,
    version: raw.Version ?? "",
    backendState: raw.BackendState ?? "",
    self,
    peers,
    magicDns: raw.MagicDNSSuffix ?? "",
    expiring,
  };
}
