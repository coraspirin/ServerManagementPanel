import "server-only";

import dgram from "node:dgram";

import { announce } from "@/lib/alerts/announce";
import { getDb } from "@/lib/db/client";
import { getBool, getNumber } from "@/lib/settings";

/**
 * M3.8 — port yönlendirme envanteri (UPnP / IGD).
 *
 * Cevaplamaya çalıştığı soru: **router'da senden habersiz açılmış yönlendirme
 * var mı?** Oyun konsolları, torrent istemcileri ve bazı uygulamalar UPnP ile
 * kendilerine port açtırır; bunlar router arayüzünde görünür ama kimse oraya
 * bakmaz. Yeni bir yönlendirme belirdiğinde panel haber veriyor.
 *
 * Bağımlılık yok: SSDP bir UDP yayını, IGD ise düz bir SOAP çağrısı.
 *
 * SINIR: yalnızca UPnP ile açılmış yönlendirmeler görünür. Router arayüzünden
 * ELLE eklenmiş bir yönlendirme UPnP listesinde çıkmayabilir — ekranda bu
 * yazıyor, aksi halde "temiz" sonucu yanlış güven verirdi.
 */

const SSDP_ADDRESS = "239.255.255.250";
const SSDP_PORT = 1900;

const SEARCH_TARGETS = [
  "urn:schemas-upnp-org:device:InternetGatewayDevice:1",
  "urn:schemas-upnp-org:service:WANIPConnection:1",
  "urn:schemas-upnp-org:service:WANPPPConnection:1",
];

export type PortForward = {
  key: string;
  protocol: string;
  externalPort: number;
  internalPort: number;
  internalHost: string;
  description: string;
  note: string;
  acknowledged: boolean;
  firstSeen: number;
  lastSeen: number;
};

export type UpnpScan = {
  supported: boolean;
  gateway: string | null;
  forwards: PortForward[];
  message: string;
};

/** SSDP M-SEARCH: yayına sorar, gelen LOCATION başlıklarını toplar. */
function discover(timeoutMs: number): Promise<string[]> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const locations = new Set<string>();

    socket.on("message", (message) => {
      const text = message.toString("utf8");
      const match = text.match(/LOCATION:\s*(\S+)/i);
      if (match) locations.add(match[1]);
    });

    socket.on("error", () => {
      try {
        socket.close();
      } catch {
        /* zaten kapalı */
      }
      resolve([...locations]);
    });

    socket.bind(() => {
      for (const target of SEARCH_TARGETS) {
        const payload = Buffer.from(
          `M-SEARCH * HTTP/1.1\r\nHOST: ${SSDP_ADDRESS}:${SSDP_PORT}\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${target}\r\n\r\n`,
        );
        socket.send(payload, SSDP_PORT, SSDP_ADDRESS);
      }
    });

    setTimeout(() => {
      try {
        socket.close();
      } catch {
        /* zaten kapalı */
      }
      resolve([...locations]);
    }, timeoutMs);
  });
}

/** Cihaz tanımından WAN bağlantı servisinin denetim adresini bulur. */
async function controlUrl(location: string, timeoutMs: number): Promise<{ url: string; type: string } | null> {
  let xml: string;
  try {
    const response = await fetch(location, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    xml = await response.text();
  } catch {
    return null;
  }

  for (const type of [
    "urn:schemas-upnp-org:service:WANIPConnection:1",
    "urn:schemas-upnp-org:service:WANPPPConnection:1",
  ]) {
    // Servis bloğunu bulup içindeki controlURL'i al. Sıra garanti değil,
    // bu yüzden blok bazında bakılıyor.
    const blocks = xml.split(/<service>/i).slice(1);
    for (const block of blocks) {
      if (!block.includes(type)) continue;
      const match = block.match(/<controlURL>\s*([^<]+)\s*<\/controlURL>/i);
      if (!match) continue;
      return { url: new URL(match[1].trim(), location).toString(), type };
    }
  }
  return null;
}

async function soap(
  url: string,
  serviceType: string,
  action: string,
  body: string,
  timeoutMs: number,
): Promise<string | null> {
  const envelope =
    '<?xml version="1.0"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
    's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>' +
    `<u:${action} xmlns:u="${serviceType}">${body}</u:${action}>` +
    "</s:Body></s:Envelope>";

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": 'text/xml; charset="utf-8"',
        soapaction: `"${serviceType}#${action}"`,
      },
      body: envelope,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

function tag(xml: string, name: string): string {
  return xml.match(new RegExp(`<${name}>([^<]*)</${name}>`, "i"))?.[1]?.trim() ?? "";
}

export async function scanPortForwards(): Promise<UpnpScan> {
  if (!getBool("security.upnp_enabled")) {
    return {
      supported: false,
      gateway: null,
      forwards: storedForwards(),
      message: "UPnP taraması kapalı. Ayarlar → Güvenlik altından açabilirsin.",
    };
  }

  const timeout = getNumber("security.upnp_timeout_seconds") * 1000;
  const locations = await discover(Math.min(timeout, 5000));

  if (locations.length === 0) {
    return {
      supported: false,
      gateway: null,
      forwards: storedForwards(),
      message:
        "Ağda UPnP destekleyen bir yönlendirici bulunamadı. Router'da UPnP kapalı olabilir — bu iyi bir şey, ama o zaman yönlendirmeleri panel göremez.",
    };
  }

  let service: { url: string; type: string } | null = null;
  let gateway: string | null = null;

  for (const location of locations) {
    service = await controlUrl(location, timeout);
    if (service) {
      gateway = new URL(location).host;
      break;
    }
  }

  if (!service) {
    return {
      supported: false,
      gateway,
      forwards: storedForwards(),
      message: "UPnP cihazı bulundu ama WAN bağlantı servisi okunamadı.",
    };
  }

  /*
    IGD'de "tüm yönlendirmeleri getir" diye bir çağrı yok; index ile tek tek
    soruluyor ve boş cevap gelene kadar devam ediliyor. Üst sınır konuyor:
    bozuk bir router sonsuza kadar cevap verebilir.
  */
  const found: {
    protocol: string;
    externalPort: number;
    internalPort: number;
    internalHost: string;
    description: string;
  }[] = [];

  for (let index = 0; index < 100; index += 1) {
    const xml = await soap(
      service.url,
      service.type,
      "GetGenericPortMappingEntry",
      `<NewPortMappingIndex>${index}</NewPortMappingIndex>`,
      timeout,
    );
    if (!xml || xml.includes("SpecifiedArrayIndexInvalid") || !xml.includes("NewExternalPort")) break;

    found.push({
      protocol: tag(xml, "NewProtocol") || "TCP",
      externalPort: Number(tag(xml, "NewExternalPort")),
      internalPort: Number(tag(xml, "NewInternalPort")),
      internalHost: tag(xml, "NewInternalClient"),
      description: tag(xml, "NewPortMappingDescription"),
    });
  }

  const fresh = await reconcile(found);

  return {
    supported: true,
    gateway,
    forwards: storedForwards(),
    message:
      found.length === 0
        ? `${gateway} üzerinde UPnP ile açılmış yönlendirme yok.`
        : `${gateway} üzerinde ${found.length} yönlendirme` +
          (fresh > 0 ? ` · ${fresh} tanesi YENİ` : ""),
  };
}

/** Bulunanları kayıtla karşılaştırır; yeni olanlar için olay üretir. */
async function reconcile(
  found: {
    protocol: string;
    externalPort: number;
    internalPort: number;
    internalHost: string;
    description: string;
  }[],
): Promise<number> {
  const db = getDb();
  const known = new Set(storedForwards().map((entry) => entry.key));
  const brandNew: string[] = [];

  for (const entry of found) {
    const key = `${entry.protocol.toLowerCase()}/${entry.externalPort}`;
    if (!known.has(key)) brandNew.push(`${key} → ${entry.internalHost}:${entry.internalPort} (${entry.description})`);

    db.prepare(
      `INSERT INTO port_forwards
         (key, protocol, external_port, internal_port, internal_host, description)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         internal_port = excluded.internal_port,
         internal_host = excluded.internal_host,
         description = excluded.description,
         last_seen = unixepoch()`,
    ).run(
      key,
      entry.protocol,
      entry.externalPort,
      entry.internalPort,
      entry.internalHost,
      entry.description,
    );
  }

  if (brandNew.length > 0) {
    await announce({
      alertKey: "security.upnp",
      source: "system",
      severity: "warning",
      title: "Router'da yeni port yönlendirmesi",
      detail:
        `${brandNew.join("\n")}\n` +
        "Bunu sen açmadıysan bir uygulama UPnP ile kendiliğinden açtırmış olabilir.",
    });
  }

  return brandNew.length;
}

export function storedForwards(): PortForward[] {
  return (
    getDb()
      .prepare(
        `SELECT key, protocol, external_port, internal_port, internal_host,
                description, note, acknowledged, first_seen, last_seen
         FROM port_forwards ORDER BY external_port`,
      )
      .all() as Record<string, string | number>[]
  ).map((row) => ({
    key: String(row.key),
    protocol: String(row.protocol),
    externalPort: Number(row.external_port),
    internalPort: Number(row.internal_port),
    internalHost: String(row.internal_host),
    description: String(row.description),
    note: String(row.note ?? ""),
    acknowledged: Number(row.acknowledged) === 1,
    firstSeen: Number(row.first_seen),
    lastSeen: Number(row.last_seen),
  }));
}

export function annotateForward(key: string, note: string, acknowledged: boolean): boolean {
  return (
    Number(
      getDb()
        .prepare("UPDATE port_forwards SET note = ?, acknowledged = ? WHERE key = ?")
        .run(note.slice(0, 500), acknowledged ? 1 : 0, key).changes,
    ) > 0
  );
}

export function forgetForward(key: string): boolean {
  return Number(getDb().prepare("DELETE FROM port_forwards WHERE key = ?").run(key).changes) > 0;
}
