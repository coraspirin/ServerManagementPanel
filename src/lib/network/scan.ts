import "server-only";

import { readFile } from "node:fs/promises";
import { reverse } from "node:dns/promises";
import net from "node:net";
import { getDb } from "@/lib/db/client";
import { isMockMode } from "@/lib/env";
import { getNumber, getString } from "@/lib/settings";
import { vendorOf } from "./oui";

/**
 * M2.9 — ağ keşfi.
 *
 * Panel container'ı LAN'da değil Docker köprüsünde duruyor; ham ARP paketi
 * gönderemez ve `arp-scan` gibi araçlar da imajda yok. Bunun yerine iki adımlı
 * bir yol izleniyor:
 *
 *   1. Alt ağdaki adreslere **TCP bağlantı denemesi** yapılır. Paketler host
 *      üzerinden LAN'a çıkar ve host'un ARP tablosunu doldurur. ICMP ping
 *      kullanılmıyor: ham soket root ister, container'da yok.
 *   2. Host'un ARP tablosu okunur ve IP→MAC eşlemesi buradan çıkarılır.
 *
 * Sonuç `arp-scan` kadar eksiksiz değil — kapalı porta sahip ve host'la hiç
 * konuşmamış bir cihaz görünmeyebilir. Karşılığında ek yetki, ek paket ve ek
 * bağımlılık gerektirmiyor.
 */

/**
 * ⚠️ `/proc/net/*` AĞ NAMESPACE'İNE tabidir: `/proc/net` aslında
 * `/proc/self/net` bağıdır ve okuyan process'in kendi görünümünü verir.
 * Host'un /proc'u mount edilmiş olsa bile `/host/proc/net/arp` container'ın
 * ARP tablosunu döndürür — sunucuda tam olarak bu yaşandı: alt ağ
 * 172.28.0.0/16 (Docker köprüsü) sanıldı ve 65 bin adres taranmaya çalışıldı.
 *
 * Host'un gerçek görünümü PID 1'in (host init) girdisinden okunur. M1.1'deki
 * metrik sağlayıcısı da aynı yolu izliyor.
 */
const ARP_PATHS = [
  process.env.HOST_PROC_ARP,
  "/host/proc/1/net/arp",
  "/proc/1/net/arp",
  "/proc/net/arp",
].filter((entry): entry is string => Boolean(entry));

const ROUTE_PATHS = [
  process.env.HOST_PROC_ROUTE,
  "/host/proc/1/net/route",
  "/proc/1/net/route",
  "/proc/net/route",
].filter((entry): entry is string => Boolean(entry));

/**
 * Taranabilecek en büyük ağ.
 *
 * /22 = 1022 adres × 6 port; bunun ötesi ev ağlarında anlamsız ve tarama
 * dakikalar yerine saatler sürer. Sınır olmadan bir yanlış alt ağ tespiti
 * (yukarıdaki /16 gibi) paneli kilitliyordu.
 */
const MAX_PREFIX_HOSTS = 1024;

async function readFirst(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf8");
    } catch {
      // sıradaki adaya bak
    }
  }
  return null;
}

/** Denenecek portlar — cihazların büyük çoğunluğu bunlardan birini açar. */
const PROBE_PORTS = [80, 443, 22, 445, 8080, 53];

export type Device = {
  mac: string;
  ip: string;
  hostname: string;
  vendor: string;
  label: string;
  known: boolean;
  firstSeen: number;
  lastSeen: number;
  online: boolean;
};

type Row = {
  mac: string;
  ip: string;
  hostname: string;
  vendor: string;
  label: string;
  known: number;
  first_seen: number;
  last_seen: number;
  online: number;
};

function toDevice(row: Row): Device {
  return {
    mac: row.mac,
    ip: row.ip,
    hostname: row.hostname,
    vendor: row.vendor,
    label: row.label,
    known: row.known === 1,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    online: row.online === 1,
  };
}

export function listDevices(): Device[] {
  return (
    getDb()
      .prepare("SELECT * FROM network_devices ORDER BY online DESC, ip")
      .all() as Row[]
  ).map(toDevice);
}

// --- Alt ağ tespiti --------------------------------------------------------

/**
 * Taranacak alt ağ.
 *
 * Ayar boşsa host'un varsayılan rotasından türetiliyor: kullanıcıdan
 * "192.168.61.0/24" yazmasını beklemek, panelin zaten bildiği bir şeyi
 * sormak olurdu. `/proc/net/route` alanları küçük-endian HEX.
 */
export async function detectSubnet(): Promise<string | null> {
  const configured = getString("network.subnet").trim();
  if (configured) return configured;

  const routes = await readFirst(ROUTE_PATHS);
  if (routes) {
    for (const line of routes.split("\n").slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 8) continue;

      const [, destination, , , , , , mask] = parts;
      // Varsayılan rota (0.0.0.0) atlanıyor; aranan şey yerel ağ girdisi.
      if (destination === "00000000") continue;

      const maskBits = maskToBits(mask);
      if (maskBits < 16 || maskBits > 30) continue;

      // Docker köprüleri elenmeli: panel kendi ağını taramamalı ve o ağ
      // genelde /16 olduğu için sınırı da aşar.
      const candidate = `${hexToIp(destination)}/${maskBits}`;
      if (2 ** (32 - maskBits) > MAX_PREFIX_HOSTS) continue;

      return candidate;
    }
  }
  return null;
}

function hexToIp(hex: string): string {
  const value = Number.parseInt(hex, 16);
  // Küçük-endian: en düşük bayt ilk oktet.
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff].join(".");
}

function maskToBits(hex: string): number {
  const value = Number.parseInt(hex, 16);
  let bits = 0;
  for (let i = 0; i < 32; i++) if ((value >> i) & 1) bits++;
  return bits;
}

/** "192.168.61.0/24" → taranacak adres listesi (ağ ve yayın adresi hariç). */
export function expandSubnet(cidr: string): string[] {
  const [base, bitsText] = cidr.split("/");
  const bits = Number(bitsText);
  if (!net.isIPv4(base) || !Number.isInteger(bits) || bits < 16 || bits > 30) return [];
  // Elle girilmiş bir ayar da sınırı aşabilir; burada da kesiliyor.
  if (2 ** (32 - bits) > MAX_PREFIX_HOSTS) return [];

  const octets = base.split(".").map(Number);
  const start = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
  const size = 2 ** (32 - bits);

  const addresses: string[] = [];
  for (let i = 1; i < size - 1; i++) {
    const value = (start + i) >>> 0;
    addresses.push(
      [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join("."),
    );
  }
  return addresses;
}

// --- Yoklama ---------------------------------------------------------------

function probe(ip: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let remaining = PROBE_PORTS.length;

    const finish = (alive: boolean) => {
      if (settled) return;
      if (alive || --remaining === 0) {
        settled = true;
        resolve(alive);
      }
    };

    for (const port of PROBE_PORTS) {
      const socket = new net.Socket();
      socket.setTimeout(timeoutMs);

      // Bağlantının KURULMASI da REDDEDİLMESİ de cihazın orada olduğunu
      // gösterir; yalnızca sessizlik "yok" demektir.
      socket.on("connect", () => {
        socket.destroy();
        finish(true);
      });
      socket.on("error", (error: NodeJS.ErrnoException) => {
        socket.destroy();
        finish(error.code === "ECONNREFUSED");
      });
      socket.on("timeout", () => {
        socket.destroy();
        finish(false);
      });

      socket.connect(port, ip);
    }
  });
}

/** ARP tablosu: IP → MAC. Eksik/geçersiz satırlar atlanır. */
async function arpTable(): Promise<Map<string, string>> {
  const table = new Map<string, string>();
  const text = await readFirst(ARP_PATHS);
  if (text) {
    for (const line of text.split("\n").slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) continue;

      const [ip, , , mac] = parts;
      // 00:00:00:00:00:00 = çözümlenememiş girdi; kayda değmez.
      if (!net.isIPv4(ip) || !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(mac)) continue;
      if (mac === "00:00:00:00:00:00") continue;

      table.set(ip, mac.toLowerCase());
    }
  }
  return table;
}

/**
 * Ters DNS ile makine adı.
 *
 * Çoğu ev ağında karşılığı yok ve sorgu zaman aşımına kadar bekler; bu yüzden
 * yalnızca YENİ cihazlar için ve kısa bir sınırla çağrılıyor.
 */
async function resolveHostname(ip: string): Promise<string> {
  try {
    const names = await Promise.race([
      reverse(ip),
      new Promise<string[]>((resolve) => setTimeout(() => resolve([]), 1500)),
    ]);
    return names[0] ?? "";
  } catch {
    return "";
  }
}

export type ScanResult = {
  subnet: string;
  scanned: number;
  alive: number;
  newDevices: Device[];
};

/**
 * Tam tarama turu.
 *
 * Eşzamanlılık sınırlı: /24 bir ağda 254 adres × 6 port = 1524 soket demek ve
 * hepsini birden açmak hem container'ın dosya tanıtıcısını hem de ev
 * yönlendiricisinin ARP tablosunu zorlar.
 */
export async function runScan(): Promise<ScanResult> {
  const subnet = (await detectSubnet()) ?? "";
  if (!subnet) {
    return { subnet: "", scanned: 0, alive: 0, newDevices: [] };
  }

  const addresses = expandSubnet(subnet);
  const timeoutMs = getNumber("network.probe_timeout") * 1000;
  const concurrency = Math.max(1, getNumber("network.scan_concurrency"));

  if (!isMockMode()) {
    const queue = [...addresses];
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (let ip = queue.pop(); ip !== undefined; ip = queue.pop()) {
        await probe(ip, timeoutMs);
      }
    });
    await Promise.all(workers);
  }

  const table = await arpTable();
  const now = Math.floor(Date.now() / 1000);
  const db = getDb();
  const newDevices: Device[] = [];

  for (const [ip, mac] of table) {
    if (!addresses.includes(ip)) continue;

    const existing = db.prepare("SELECT * FROM network_devices WHERE mac = ?").get(mac) as
      | Row
      | undefined;

    if (existing) {
      // Üretici geriye dönük dolduruluyor: OUI listesi ilk taramadan SONRA
      // indirilmiş olabilir ve o cihazların üretici alanı sonsuza kadar boş
      // kalırdı. `existing.vendor` doluysa dokunulmuyor — liste değişse bile
      // kullanıcının gördüğü ad sabit kalsın.
      const vendor = existing.vendor || vendorOf(mac);

      db.prepare(
        "UPDATE network_devices SET ip = ?, vendor = ?, last_seen = ?, online = 1 WHERE mac = ?",
      ).run(ip, vendor, now, mac);
      continue;
    }

    const hostname = await resolveHostname(ip);
    db.prepare(
      `INSERT INTO network_devices (mac, ip, hostname, vendor, first_seen, last_seen, online)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
    ).run(mac, ip, hostname, vendorOf(mac), now, now);

    newDevices.push({
      mac,
      ip,
      hostname,
      vendor: vendorOf(mac),
      label: "",
      known: false,
      firstSeen: now,
      lastSeen: now,
      online: true,
    });
  }

  // Bu turda görülmeyenler çevrimdışı işaretleniyor ama SİLİNMİYOR: kapalı bir
  // cihazın envanterden düşmesi, "bu cihaz ne zamandır yok" sorusunu
  // cevaplanamaz yapardı.
  db.prepare("UPDATE network_devices SET online = 0 WHERE last_seen < ?").run(now);

  return { subnet, scanned: addresses.length, alive: table.size, newDevices };
}

export function setDeviceKnown(mac: string, known: boolean, label: string): void {
  getDb()
    .prepare("UPDATE network_devices SET known = ?, label = ? WHERE mac = ?")
    .run(known ? 1 : 0, label.trim(), mac);
}

export function deleteDevice(mac: string): void {
  getDb().prepare("DELETE FROM network_devices WHERE mac = ?").run(mac);
}
