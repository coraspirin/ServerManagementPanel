import "server-only";
import { serverT } from "@/lib/i18n/runtime";

import { readCache, writeCache } from "@/lib/db/cache";
import { currentHostId, LOCAL_HOST_ID } from "@/lib/hosts/context";
import { panelImage } from "@/lib/host/self";
import { getDockerProvider } from "@/lib/providers";
import {
  buildPortMap,
  type ContainerFacts,
  type ListeningPort,
  type RawSocket,
} from "@/lib/security/portmap";

/**
 * M3.7 / M3.17 — dinleyen port envanteri.
 *
 * `ss` ya da `netstat` çağırmak yerine `/proc/net/*` doğrudan okunuyor: çıktı
 * biçimi sabit ve ayrıştırması kararlı, oysa `ss`'in sürüm farkları kolon
 * düzenini değiştiriyor.
 *
 * İKİ AD ALANI SORUNU: `/proc/net/*` AĞ ad alanına bağlı, `/proc/<pid>/fd` ise
 * PID ad alanına. Panel container'ı ikisinde de kendi ad alanında olduğu için
 * host'un portlarını göremez. Bu yüzden tarama, `network=host` ve `pid=host`
 * ile açılan tek seferlik bir container'da yapılıyor — M2.11'de metrik
 * tarafında yaşanan "container kendi ağını taradı" hatasının aynısı.
 *
 * M3.17'de eklenen: aynı container içinde `/proc/<pid>/cgroup` de okunuyor.
 * Tek dosya hem container id'sini hem systemd unit adını veriyor; sahiplik
 * çözümü `portmap.ts` içinde yapılıyor.
 *
 * ⚠️ RİSK DEĞERLENDİRMESİ BURADA YAPILMIYOR, yalnızca gerçek raporlanıyor:
 * "0.0.0.0'a bind edilmiş" bilgisi veriliyor, "tehlikeli" damgası
 * vurulmuyor — 0.0.0.0:53 Pi-hole için doğru yapılandırmadır.
 */

export type { ListeningPort, PortOwner } from "@/lib/security/portmap";

const CACHE_KEY = "security.ports";

/** Sunucu başına önbellek; yerel sunucu eski anahtarı koruyor. */
function cacheKey(): string {
  const hostId = currentHostId();
  return hostId === LOCAL_HOST_ID ? CACHE_KEY : `h${hostId}:${CACHE_KEY}`;
}

/**
 * Container içinde çalışan sabit script.
 *
 * /proc/net/tcp'deki adres alanı LITTLE-ENDIAN onaltılık: "0100007F:0035"
 * → 127.0.0.1:53. Bayt sırasını ters çevirmeden okumak 1.0.0.127 verir.
 */
const SCRIPT = `
const fs = require("node:fs");

function ipv4(hex) {
  const bytes = hex.match(/../g).reverse().map((b) => parseInt(b, 16));
  return bytes.join(".");
}

function ipv6(hex) {
  // 32 hex karakter, 4'lü gruplar hâlinde little-endian.
  const groups = [];
  for (let i = 0; i < 32; i += 8) {
    const word = hex.slice(i, i + 8).match(/../g).reverse().join("");
    groups.push(word.slice(0, 4), word.slice(4, 8));
  }
  const full = groups.join(":");
  return full === "0000:0000:0000:0000:0000:0000:0000:0000" ? "::" : full;
}

function parse(file, proto) {
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch { return []; }
  const out = [];
  const lines = text.split("\\n").slice(1);

  for (const line of lines) {
    const parts = line.trim().split(/\\s+/);
    if (parts.length < 10) continue;
    const [localHex, portHex] = parts[1].split(":");
    const state = parts[3];
    // TCP'de 0A = LISTEN. UDP'de durum kavramı yok, hepsi alınır.
    if (proto.startsWith("tcp") && state !== "0A") continue;

    out.push({
      protocol: proto,
      address: proto.endsWith("6") ? ipv6(localHex) : ipv4(localHex),
      port: parseInt(portHex, 16),
      inode: parts[9],
    });
  }
  return out;
}

// Süreç başına bir kez okunur: çok soketli bir süreçte (docker-proxy) aynı
// dosyayı onlarca kez açmanın anlamı yok.
const cgroupByPid = new Map();
function cgroupOf(pid) {
  if (cgroupByPid.has(pid)) return cgroupByPid.get(pid);
  let text = "";
  try {
    // Satırlar boşlukla birleştiriliyor: v1'de birden çok denetleyici satırı
    // olur, hangisinin docker yolunu taşıdığı sürüme göre değişir.
    text = fs.readFileSync("/proc/" + pid + "/cgroup", "utf8").split("\\n").join(" ").trim();
  } catch {}
  cgroupByPid.set(pid, text);
  return text;
}

// Soket inode -> süreç eşlemesi: her sürecin açık dosya tanıtıcılarına bakılır.
const byInode = new Map();
let pids = [];
try { pids = fs.readdirSync("/proc").filter((n) => /^\\d+$/.test(n)); } catch {}

for (const pid of pids) {
  let fds = [];
  try { fds = fs.readdirSync("/proc/" + pid + "/fd"); } catch { continue; }
  for (const fd of fds) {
    let link = "";
    try { link = fs.readlinkSync("/proc/" + pid + "/fd/" + fd); } catch { continue; }
    const match = link.match(/^socket:\\[(\\d+)\\]$/);
    if (!match) continue;
    if (byInode.has(match[1])) continue;
    let name = "";
    try { name = fs.readFileSync("/proc/" + pid + "/comm", "utf8").trim(); } catch {}
    byInode.set(match[1], { pid: Number(pid), name, cgroup: cgroupOf(pid) });
  }
}

const rows = [
  ...parse("/proc/net/tcp", "tcp"),
  ...parse("/proc/net/tcp6", "tcp6"),
  ...parse("/proc/net/udp", "udp"),
  ...parse("/proc/net/udp6", "udp6"),
].map((row) => {
  const owner = byInode.get(row.inode);
  return {
    protocol: row.protocol,
    address: row.address,
    port: row.port,
    pid: owner ? owner.pid : null,
    process: owner ? owner.name : "",
    cgroup: owner ? owner.cgroup : "",
  };
});

console.log(JSON.stringify({ ok: true, rows }));
`;

export type PortScan = {
  ports: ListeningPort[];
  /**
   * Docker'dan okunan container gerçekleri.
   *
   * Ekrana da gidiyor: boş port bulucu ve çakışma tespiti DURMUŞ container'ları
   * da hesaba katmak zorunda, o bilgi dinleyen soket listesinde yok.
   */
  containers: ContainerFacts[];
  error: string | null;
};

/** Önbellekten okunan tarama — yaşı her zaman yanında (M1.10). */
export type CachedPortScan = PortScan & { updatedAt: number | null };

const EMPTY: PortScan = { ports: [], containers: [], error: null };

export async function scanListeningPorts(): Promise<PortScan> {
  const containers = await containerFacts();

  const image = await panelImage();
  if (!image) {
    return { ...EMPTY, containers, error: serverT("stacks.noPanelImage") };
  }

  let output: string;
  try {
    const result = await getDockerProvider().runThrowaway({
      image,
      cmd: ["node", "-e", SCRIPT],
      binds: [],
      env: {},
      namePrefix: "panel-ports",
      timeoutMs: 60_000,
      user: "0:0",
      networkMode: "host",
      pidMode: "host",
      // ⚠️ İKİSİ BİRLİKTE GEREKİYOR — gerçek sunucuda ölçüldü (bkz. T13).
      //
      // `/proc/<pid>/fd` dizinini LİSTELEMEK serbest, ama içindeki sembolik
      // bağı OKUMAK hedef sürece ptrace erişimi istiyor. Eksik olanın yalnızca
      // SYS_PTRACE olduğu sanılmıştı; tek başına verildiğinde 57 soketin
      // 15'inden 17'sine çıkardı, yani neredeyse hiçbir şeye yaramadı. Sebep:
      // Docker'ın varsayılan AppArmor profili ptrace'i "aynı profildeki
      // süreçler" ile sınırlıyor ve host süreçleri (sshd, tailscaled,
      // docker-proxy, systemd) o profilde değil. İkisi birlikte verildiğinde
      // 57/57 çözüldü.
      //
      // Genişletmenin sınırı: container kısa ömürlü, komutu sabit, zaten root
      // ve host ağ/PID ad alanında. Bunları verebilmek için gereken
      // docker.sock erişimi host'ta zaten root demek (T4) — yeni bir yetki
      // kazanılmıyor, var olan yetki kullanılabilir hâle geliyor.
      capAdd: ["SYS_PTRACE"],
      securityOpt: ["apparmor=unconfined"],
    });

    if (result.exitCode !== 0) {
      return {
        ...EMPTY,
        containers,
        error: result.output.slice(0, 300) || serverT("portsLib.scanFailed"),
      };
    }
    output = result.stdout ?? result.output;
  } catch (error) {
    return {
      ...EMPTY,
      containers,
      error: error instanceof Error ? error.message : serverT("portsLib.scanExec"),
    };
  }

  const line = output
    .split("\n")
    .map((entry) => entry.trim())
    .reverse()
    .find((entry) => entry.startsWith("{"));
  if (!line) {
    return { ...EMPTY, containers, error: serverT("portsLib.parseFailed") };
  }

  let parsed: { rows: RawSocket[] };
  try {
    parsed = JSON.parse(line) as typeof parsed;
  } catch {
    return { ...EMPTY, containers, error: serverT("portsLib.notJson") };
  }

  const scan: PortScan = {
    ports: buildPortMap(parsed.rows, containers),
    containers,
    error: null,
  };

  writeCache(cacheKey(), scan);
  return scan;
}

/**
 * Ekranın ilk açılışında kullanılan yol: önbellek varsa onu döndürür, yoksa
 * tarama yapmadan boş döner.
 *
 * Sayfa açılışında container AÇILMIYOR — tarama pahalı (birkaç saniye) ve
 * kullanıcının her sayfa girişinde ödemesi gereken bir bedel değil. Tazeleme
 * ya `ports.scan` işiyle ya da kullanıcının düğmesiyle olur.
 */
export function cachedPortScan(): CachedPortScan {
  const cached = readCache<PortScan>(cacheKey());
  if (!cached) return { ...EMPTY, updatedAt: null };
  return { ...cached.value, updatedAt: cached.updatedAt };
}

export async function portScan(refresh: boolean): Promise<CachedPortScan> {
  if (!refresh) {
    const cached = cachedPortScan();
    if (cached.updatedAt !== null) return cached;
  }

  const scan = await scanListeningPorts();
  return { ...scan, updatedAt: Math.floor(Date.now() / 1000) };
}

/**
 * Docker'ın bildiği container'lar — DURMUŞ OLANLAR DAHİL (`list(true)`).
 *
 * Durmuş bir container'ın portu şu an dinlenmiyor ama o container
 * başlatıldığında çakışır; "hangi port boş" sorusunun doğru cevabı bunu
 * hesaba katmak zorunda.
 */
async function containerFacts(): Promise<ContainerFacts[]> {
  try {
    return (await getDockerProvider().list(true)).map((container) => ({
      id: container.id,
      name: container.name,
      state: container.state,
      composeProject: container.composeProject,
      ports: container.ports.map((port) => ({
        hostPort: port.hostPort,
        containerPort: port.containerPort,
        protocol: port.protocol,
      })),
    }));
  } catch {
    // Docker okunamazsa port listesi sahipsiz gösterilir; tarama yine çalışır.
    return [];
  }
}
