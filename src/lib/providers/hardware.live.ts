import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type {
  HardwareProvider,
  HardwareReport,
  SmartDisk,
  StoragePool,
  TemperatureReading,
} from "./types";

/**
 * M1.4 — donanım sağlığı.
 *
 * İŞ BÖLÜMÜ, bilinçli:
 *   - Sıcaklık ve mdraid durumu doğrudan container'dan okunur (`/sys`, `/proc`).
 *     Bunlar salt-okunur dosyalar; ek yetki gerektirmez.
 *   - S.M.A.R.T ve ZFS ise HOST'ta çalışan bir script'ten gelir
 *     (`scripts/hardware.sh`, host cron). Sebep: `smartctl` ham disk erişimi
 *     (SYS_RAWIO) ister, `zpool` host araçlarını. Bunları container'a vermek,
 *     paneli okumak için tüm disklere ham erişim açmak demekti — T4'teki
 *     "container'a root verme" ilkesine aykırı. Script çıktısını JSON olarak
 *     salt-okunur bir dizine bırakır, panel yalnızca okur.
 */

const HOST_SYS = process.env.HOST_SYS ?? "/host/sys";
const HOST_PROC = process.env.HOST_PROC ?? "/host/proc";
const REPORTS_DIR = process.env.REPORTS_DIR ?? "/app/reports";

async function readText(file: string): Promise<string | null> {
  try {
    return (await readFile(file, "utf8")).trim();
  } catch {
    return null;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/** hwmon değerleri milidereceden gelir. */
function milliToCelsius(raw: string | null): number | null {
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.round(value / 100) / 10 : null;
}

async function readTemperatures(notes: string[]): Promise<TemperatureReading[]> {
  const base = path.join(HOST_SYS, "class/hwmon");
  let entries: string[];
  try {
    entries = await readdir(base);
  } catch {
    notes.push(`Sensör dizini okunamadı (${base}). /sys mount edilmiş mi?`);
    return [];
  }

  const readings: TemperatureReading[] = [];

  for (const entry of entries) {
    const dir = path.join(base, entry);
    const source = (await readText(path.join(dir, "name"))) ?? entry;

    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }

    for (const file of files.filter((f) => /^temp\d+_input$/.test(f))) {
      const prefix = file.replace("_input", "");
      const celsius = milliToCelsius(await readText(path.join(dir, file)));
      if (celsius === null) continue;

      // 0 °C okuyan sensör neredeyse her zaman bağlı olmayan bir kanaldır.
      if (celsius === 0) continue;

      const label =
        (await readText(path.join(dir, `${prefix}_label`))) ?? prefix.replace("temp", "sensör ");

      readings.push({
        id: `${source}/${prefix}`,
        source,
        label,
        celsius,
        highC: milliToCelsius(await readText(path.join(dir, `${prefix}_max`))),
        criticalC: milliToCelsius(await readText(path.join(dir, `${prefix}_crit`))),
      });
    }
  }

  return readings.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * /proc/mdstat ayrıştırması.
 *
 * Örnek:
 *   md0 : active raid1 sdb1[1] sda1[0]
 *         976630464 blocks super 1.2 [2/2] [UU]
 * `[2/2] [UU]` sağlıklı; `[2/1] [U_]` bir disk düşmüş demektir.
 */
function parseMdstat(content: string): StoragePool[] {
  const pools: StoragePool[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const header = lines[i].match(/^(md\d+)\s*:\s*(\w+)\s+(\S+)\s+(.*)$/);
    if (!header) continue;

    const [, name, activity, level, memberText] = header;
    const devices = [...memberText.matchAll(/(\w+)\[\d+\](\(([FS])\))?/g)].map((m) => ({
      name: m[1],
      state: m[3] === "F" ? "arızalı" : m[3] === "S" ? "yedek" : "etkin",
    }));

    const body = lines.slice(i + 1, i + 4).join(" ");
    const status = body.match(/\[(\d+)\/(\d+)\]\s*\[([U_]+)\]/);
    const resync = body.match(/(resync|recovery|reshape|check)\s*=\s*([\d.]+%)/);

    const total = status ? Number(status[1]) : devices.length;
    const active = status ? Number(status[2]) : devices.length;
    const degraded = active < total;

    pools.push({
      name,
      kind: "mdraid",
      state: resync ? `${resync[1]} (${resync[2]})` : degraded ? "degraded" : activity,
      healthy: !degraded && activity === "active",
      detail: `${level} · ${active}/${total} disk etkin${status ? ` [${status[3]}]` : ""}`,
      devices,
      lastScrubAt: null,
      scrubResult: null,
    });
  }

  return pools;
}

async function readMdraid(): Promise<StoragePool[]> {
  const content = await readText(path.join(HOST_PROC, "mdstat"));
  return content ? parseMdstat(content) : [];
}

/** Host script'inin bıraktığı JSON — S.M.A.R.T ve ZFS burada. */
type ReportFile = {
  generatedAt?: number;
  disks?: SmartDisk[];
  pools?: StoragePool[];
  errors?: string[];
};

async function readHostReport(notes: string[]): Promise<ReportFile | null> {
  const file = path.join(REPORTS_DIR, "hardware.json");
  if (!(await exists(file))) {
    notes.push(
      "S.M.A.R.T ve ZFS raporu yok. Host'ta scripts/hardware.sh kurulmamış olabilir (bkz. DEPLOY.md).",
    );
    return null;
  }

  const raw = await readText(file);
  if (raw === null) return null;

  try {
    const parsed = JSON.parse(raw) as ReportFile;
    for (const error of parsed.errors ?? []) notes.push(`Host raporu: ${error}`);
    return parsed;
  } catch {
    notes.push(`Host raporu okunamadı (${file} geçerli JSON değil).`);
    return null;
  }
}

/** Sanal makinede fiziksel sensör ve S.M.A.R.T zaten yoktur — boş panel değil, açıklama. */
async function detectVirtualization(): Promise<string | null> {
  const vendor = await readText(path.join(HOST_SYS, "class/dmi/id/sys_vendor"));
  const product = await readText(path.join(HOST_SYS, "class/dmi/id/product_name"));
  const text = `${vendor ?? ""} ${product ?? ""}`.trim();

  if (/microsoft|hyper-v/i.test(text)) return "Hyper-V sanal makinesi";
  if (/vmware/i.test(text)) return "VMware sanal makinesi";
  if (/qemu|kvm|bochs/i.test(text)) return "QEMU/KVM sanal makinesi";
  if (/virtualbox|innotek/i.test(text)) return "VirtualBox sanal makinesi";
  if (/xen/i.test(text)) return "Xen sanal makinesi";
  return null;
}

export const liveHardwareProvider: HardwareProvider = {
  async report(): Promise<HardwareReport> {
    const notes: string[] = [];

    const [temperatures, mdPools, hostReport, virtualization] = await Promise.all([
      readTemperatures(notes),
      readMdraid(),
      readHostReport(notes),
      detectVirtualization(),
    ]);

    const pools = [...mdPools, ...(hostReport?.pools ?? [])];
    const disks = hostReport?.disks ?? [];

    if (virtualization && temperatures.length === 0 && disks.length === 0) {
      // En üste alınıyor: asıl açıklama bu, diğer notlar sonucu.
      notes.unshift(
        `Sunucu ${virtualization} olarak çalışıyor — sanal donanımda sıcaklık sensörü ve S.M.A.R.T verisi bulunmaz. Bu bir arıza değil.`,
      );
    } else if (temperatures.length === 0) {
      notes.push(
        "Sıcaklık sensörü bulunamadı. Fiziksel makinede `sensors-detect` ile sürücü (coretemp, k10temp…) yüklenmesi gerekebilir.",
      );
    }

    return {
      temperatures,
      disks,
      pools,
      reportedAt: hostReport?.generatedAt ?? null,
      virtualization,
      notes,
    };
  },
};
