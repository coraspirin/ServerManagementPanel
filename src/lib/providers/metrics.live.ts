import { access, readFile, statfs } from "node:fs/promises";
import path from "node:path";
import { getString } from "@/lib/settings";
import type { MetricSample, MetricsProvider } from "./types";

/**
 * M1.1 — host sistem metrikleri (Linux /proc + /sys).
 *
 * Container içinden HOST'un metrikleri okunur, container'ınkiler değil:
 *   - `/proc/stat`, `/proc/meminfo` container'da zaten host değerlerini verir,
 *     ama `/proc/net/dev` AĞ NAMESPACE'İNE tabidir; container'ın kendi eth0'ını
 *     gösterir. Bu yüzden host'un /proc'u `/host/proc` altına mount edilir
 *     (node_exporter'ın `--path.procfs` yaklaşımı).
 *   - Disk doluluğu hiçbir /proc dosyasında yok; `statfs` çağrısı gerçek bir
 *     yol ister. Bu yüzden host kökü `/host/root` altına salt-okunur mount
 *     edilir. Mount yoksa yalnızca container'ın gördüğü dosya sistemleri
 *     raporlanır — panel çökmez, eksik raporlar.
 *
 * Mount'lar yoksa (panel doğrudan host'ta çalışıyorsa) `/proc`, `/sys` ve `/`
 * kullanılır; bu yüzden yol seçimi ilk çağrıda bir kez sınanır.
 */

const CANDIDATES = {
  proc: [process.env.HOST_PROC, "/host/proc", "/proc"],
  sys: [process.env.HOST_SYS, "/host/sys", "/sys"],
  root: [process.env.HOST_ROOT_FS, "/host/root", "/"],
} as const;

let resolvedRoots: { proc: string; sys: string; root: string } | null = null;

async function firstExisting(candidates: readonly (string | undefined)[], probe: string) {
  for (const base of candidates) {
    if (!base) continue;
    try {
      await access(path.join(base, probe));
      return base;
    } catch {
      // sıradakine bak
    }
  }
  return null;
}

async function roots() {
  if (resolvedRoots) return resolvedRoots;
  const [proc, sys, root] = await Promise.all([
    firstExisting(CANDIDATES.proc, "stat"),
    firstExisting(CANDIDATES.sys, "class/net"),
    firstExisting(CANDIDATES.root, "."),
  ]);
  resolvedRoots = { proc: proc ?? "/proc", sys: sys ?? "/sys", root: root ?? "/" };
  return resolvedRoots;
}

/**
 * PROCESS'E ÖZEL /proc DOSYALARI — burası bir tuzak.
 *
 * `/proc/mounts` ve `/proc/net/dev` aslında `/proc/self/...` sembolik bağıdır:
 * okuyan process'in KENDİ mount ve ağ namespace'ini gösterirler. Host'un /proc'u
 * container'a mount edilse bile bu iki dosya container'ın görünümünü verir.
 *
 * YAŞANMIŞ HATA: sunucuda ağ grafiği container'ın eth0'ını (birkaç yüz bayt)
 * çizdi ve mount tablosunda yalnızca `overlay /` göründüğü için HİÇ disk
 * metriği üretilmedi — üstelik sessizce, çünkü okunamayan bölüm atlanıyor.
 *
 * Host'un gerçek görünümü PID 1'in (host init) girdisinden okunur. Panel
 * doğrudan host'ta çalıştığında da PID 1 doğru cevabı verir, o yüzden sıra her
 * zaman aynı; erişilemezse (hidepid) normal yola düşülür.
 */
const PER_PROCESS_FILES = new Set(["mounts", "net/dev"]);

async function readProc(file: string): Promise<string | null> {
  const base = (await roots()).proc;
  const candidates = PER_PROCESS_FILES.has(file)
    ? [path.join(base, "1", file), path.join(base, file)]
    : [path.join(base, file)];

  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf8");
    } catch {
      // sıradaki adaya bak
    }
  }
  return null;
}

// --- Önceki okuma (oran hesabı için) ---------------------------------------

type CpuTimes = { total: number; idle: number; iowait: number };
type NetCounters = Record<string, { rx: number; tx: number }>;

let prevCpu: CpuTimes | null = null;
let prevNet: { at: number; counters: NetCounters } | null = null;

// --- CPU -------------------------------------------------------------------

function parseCpuLine(content: string): CpuTimes | null {
  const line = content.split("\n").find((l) => l.startsWith("cpu "));
  if (!line) return null;

  // cpu user nice system idle iowait irq softirq steal guest guest_nice
  const fields = line.trim().split(/\s+/).slice(1).map(Number);
  if (fields.length < 5 || fields.some((n) => !Number.isFinite(n))) return null;

  // guest ve guest_nice zaten user/nice içinde sayılır; toplamda tekrar ekleme.
  const counted = fields.slice(0, 8);
  return {
    total: counted.reduce((sum, n) => sum + n, 0),
    idle: fields[3],
    iowait: fields[4],
  };
}

async function cpuSamples(): Promise<MetricSample[]> {
  const content = await readProc("stat");
  if (!content) return [];

  const now = parseCpuLine(content);
  if (!now) return [];

  const prev = prevCpu;
  prevCpu = now;
  if (!prev) return []; // ilk okuma: fark yok

  const totalDelta = now.total - prev.total;
  if (totalDelta <= 0) return [];

  const idleDelta = now.idle - prev.idle + (now.iowait - prev.iowait);
  const busyPct = ((totalDelta - idleDelta) / totalDelta) * 100;
  const iowaitPct = ((now.iowait - prev.iowait) / totalDelta) * 100;

  return [
    { metric: "cpu.pct", value: clampPct(busyPct) },
    { metric: "cpu.iowait_pct", value: clampPct(iowaitPct) },
  ];
}

function clampPct(value: number): number {
  return Math.min(100, Math.max(0, Number(value.toFixed(2))));
}

// --- Bellek ----------------------------------------------------------------

async function memorySamples(): Promise<MetricSample[]> {
  const content = await readProc("meminfo");
  if (!content) return [];

  const values = new Map<string, number>();
  for (const line of content.split("\n")) {
    const match = line.match(/^(\w+):\s+(\d+)\s*kB$/);
    if (match) values.set(match[1], Number(match[2]) * 1024);
  }

  const total = values.get("MemTotal") ?? 0;
  if (total === 0) return [];

  // MemAvailable, çekirdeğin "yeni işlere gerçekten verilebilir" tahminidir;
  // free+cache'ten daha doğrudur (geri alınamayan slab/cache'i hariç tutar).
  const available = values.get("MemAvailable") ?? values.get("MemFree") ?? 0;
  const used = total - available;

  const samples: MetricSample[] = [
    { metric: "mem.total", value: total },
    { metric: "mem.used", value: used },
    { metric: "mem.used_pct", value: clampPct((used / total) * 100) },
  ];

  const swapTotal = values.get("SwapTotal") ?? 0;
  if (swapTotal > 0) {
    const swapUsed = swapTotal - (values.get("SwapFree") ?? 0);
    samples.push(
      { metric: "swap.used", value: swapUsed },
      { metric: "swap.used_pct", value: clampPct((swapUsed / swapTotal) * 100) },
    );
  }

  return samples;
}

// --- Yük ortalaması & çalışma süresi ---------------------------------------

async function loadSamples(): Promise<MetricSample[]> {
  const content = await readProc("loadavg");
  if (!content) return [];

  const [one, five, fifteen] = content.trim().split(/\s+/).map(Number);
  if (!Number.isFinite(one)) return [];

  return [
    { metric: "load.1m", value: one },
    { metric: "load.5m", value: five },
    { metric: "load.15m", value: fifteen },
  ];
}

async function uptimeSamples(): Promise<MetricSample[]> {
  const content = await readProc("uptime");
  if (!content) return [];
  const seconds = Number(content.trim().split(/\s+/)[0]);
  return Number.isFinite(seconds) ? [{ metric: "uptime.seconds", value: seconds }] : [];
}

// --- Disk ------------------------------------------------------------------

/** Gerçek veri tutan dosya sistemleri. tmpfs/overlay/proc gibi sanal olanlar elenir. */
const REAL_FSTYPES = new Set([
  "ext2", "ext3", "ext4", "xfs", "btrfs", "zfs", "f2fs", "jfs", "reiserfs",
  "vfat", "exfat", "ntfs", "ntfs3", "hfsplus", "ufs", "bcachefs",
]);

/** Panelin ilgilenmediği, gürültü yaratan mount noktaları. */
function isNoisyMount(mountpoint: string): boolean {
  return (
    mountpoint.startsWith("/snap/") ||
    mountpoint.startsWith("/var/lib/docker/") ||
    mountpoint.startsWith("/var/snap/") ||
    mountpoint.startsWith("/boot/efi")
  );
}

type MountEntry = { device: string; mountpoint: string };

async function listMounts(): Promise<MountEntry[]> {
  const content = await readProc("mounts");
  if (!content) return [];

  const byMountpoint = new Map<string, MountEntry>();
  const seenDevices = new Map<string, string>();

  for (const line of content.split("\n")) {
    const [device, rawMount, fstype] = line.split(/\s+/);
    if (!device || !rawMount || !REAL_FSTYPES.has(fstype)) continue;

    // /proc/mounts boşlukları sekizlik kaçışla yazar.
    const mountpoint = rawMount.replace(/\\040/g, " ");
    if (isNoisyMount(mountpoint)) continue;

    // Aynı cihaz birden çok yere bağlıysa (bind mount) en kısa yolu tut:
    // kullanıcı "/" görmek ister, "/mnt/bind/rootfs" değil.
    const existing = seenDevices.get(device);
    if (existing !== undefined) {
      if (existing.length <= mountpoint.length) continue;
      byMountpoint.delete(existing);
    }
    seenDevices.set(device, mountpoint);
    byMountpoint.set(mountpoint, { device, mountpoint });
  }

  return [...byMountpoint.values()].sort((a, b) =>
    a.mountpoint.localeCompare(b.mountpoint),
  );
}

async function diskSamples(): Promise<MetricSample[]> {
  const configured = getString("monitoring.disks")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const mounts =
    configured.length > 0
      ? configured.map((mountpoint) => ({ device: "", mountpoint }))
      : await listMounts();

  const hostRoot = (await roots()).root;
  const samples: MetricSample[] = [];

  for (const mount of mounts) {
    // "/" host kökünün kendisidir; "/srv" → "<hostRoot>/srv".
    const probePath =
      mount.mountpoint === "/" ? hostRoot : path.join(hostRoot, mount.mountpoint);

    try {
      const fs = await statfs(probePath);
      const total = fs.blocks * fs.bsize;
      if (total === 0) continue;

      // df ile aynı hesap: kullanılabilir alan ayrıcalıksız kullanıcıya göre
      // (bavail), kullanılan alan rezerve blokları da içerir (blocks - bfree).
      const used = (fs.blocks - fs.bfree) * fs.bsize;
      const available = fs.bavail * fs.bsize;
      const denominator = used + available;

      samples.push(
        { metric: "disk.total", label: mount.mountpoint, value: total },
        { metric: "disk.used", label: mount.mountpoint, value: used },
        { metric: "disk.free", label: mount.mountpoint, value: available },
        {
          metric: "disk.used_pct",
          label: mount.mountpoint,
          value: denominator > 0 ? clampPct((used / denominator) * 100) : 0,
        },
      );
    } catch {
      // Mount edilmemiş ya da erişilemeyen bölüm — sessizce atla.
    }
  }

  return samples;
}

// --- Ağ --------------------------------------------------------------------

/** Fiziksel arayüzler /sys altında bir `device` bağlantısı taşır; veth/bridge taşımaz. */
async function isPhysical(iface: string): Promise<boolean> {
  try {
    await access(path.join((await roots()).sys, "class/net", iface, "device"));
    return true;
  } catch {
    return false;
  }
}

async function netSamples(): Promise<MetricSample[]> {
  const content = await readProc("net/dev");
  if (!content) return [];

  const counters: NetCounters = {};
  for (const line of content.split("\n").slice(2)) {
    const [namePart, rest] = line.split(":");
    if (!rest) continue;
    const iface = namePart.trim();
    const fields = rest.trim().split(/\s+/).map(Number);
    if (fields.length < 10) continue;
    counters[iface] = { rx: fields[0], tx: fields[8] };
  }

  const configured = getString("monitoring.net_interfaces")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const candidates = Object.keys(counters).filter((iface) => iface !== "lo");
  const selected =
    configured.length > 0
      ? candidates.filter((iface) => configured.includes(iface))
      : (await Promise.all(candidates.map(async (i) => ((await isPhysical(i)) ? i : null))))
          .filter((i): i is string => i !== null);

  const now = Date.now();
  const prev = prevNet;
  prevNet = { at: now, counters };
  if (!prev) return [];

  const elapsed = (now - prev.at) / 1000;
  if (elapsed <= 0) return [];

  const samples: MetricSample[] = [];
  for (const iface of selected) {
    const before = prev.counters[iface];
    const after = counters[iface];
    if (!before || !after) continue;

    // Sayaç 32-bit sınırında sarabilir ya da arayüz sıfırlanmış olabilir;
    // negatif fark uydurma bir zirve üretmesin diye atlanır.
    const rx = after.rx - before.rx;
    const tx = after.tx - before.tx;
    if (rx < 0 || tx < 0) continue;

    samples.push(
      { metric: "net.rx_bps", label: iface, value: Math.round(rx / elapsed) },
      { metric: "net.tx_bps", label: iface, value: Math.round(tx / elapsed) },
    );
  }

  return samples;
}

// --- Sağlayıcı -------------------------------------------------------------

/**
 * Eksik metrik sessiz kalmasın. Disk ve ağ okuması hatalı mount ya da izin
 * yüzünden boş dönebiliyor; kartlar boş görünür ama hiçbir yerde hata yazmaz.
 * Bir kez uyarıp log'u boğmuyoruz.
 */
let warnedNoDisks = false;
let warnedNoNet = false;

export const liveMetricsProvider: MetricsProvider = {
  async sample(): Promise<MetricSample[]> {
    const hadPreviousNetRead = prevNet !== null;

    const [cpu, memory, load, uptime, disks, net] = await Promise.all([
      cpuSamples(),
      memorySamples(),
      loadSamples(),
      uptimeSamples(),
      diskSamples(),
      netSamples(),
    ]);

    if (disks.length === 0 && !warnedNoDisks) {
      warnedNoDisks = true;
      const { proc, root } = await roots();
      console.warn(
        `[metrics] hiç disk bölümü okunamadı — ${proc}/1/mounts okunuyor mu ve ` +
          `host kökü ${root} altında mount edilmiş mi? (docker-compose: /:/host/root:ro)`,
      );
    }

    if (net.length === 0 && hadPreviousNetRead && !warnedNoNet) {
      warnedNoNet = true;
      const { sys } = await roots();
      console.warn(
        `[metrics] hiç ağ arayüzü okunamadı — fiziksel arayüz ${sys}/class/net ` +
          "altında bulunamadı. Ayarlardan monitoring.net_interfaces ile elle belirtilebilir.",
      );
    }

    return [...cpu, ...memory, ...load, ...uptime, ...disks, ...net];
  },
};
