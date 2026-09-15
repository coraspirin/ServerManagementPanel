import "server-only";

import { readdirSync, rmSync, statSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { dataDir } from "@/lib/db/client";
import { getDockerProvider } from "@/lib/providers";
import type { PruneScope } from "@/lib/providers/types";
import { hostRoot } from "./paths";
import { removeFilesIn } from "./write";

/**
 * M3.5 — disk temizlik asistanı.
 *
 * Soruyu tersine çeviriyor: "diskim doldu, ne silebilirim?" Panel tarama
 * yapıp **kalem kalem** ne kadar yer kazanılabileceğini söylüyor ve her
 * kalemi ayrı ayrı, onaylı ve audit'li olarak temizliyor.
 *
 * TEK BİR "hepsini temizle" DÜĞMESİ YOK. Kalemlerin riski çok farklı: sarkan
 * image'ları silmek zararsız, kullanılmayan volume'leri silmek VERİ KAYBIDIR.
 * Aynı düğmenin altına konmaları yanlış olurdu.
 */

export type CleanupRisk = "safe" | "caution" | "destructive";

export type CleanupItem = {
  id: string;
  label: string;
  description: string;
  bytes: number;
  /** Kaç öğe etkilenecek (dosya sayısı, image sayısı…). */
  count: number;
  risk: CleanupRisk;
  /** Temizlemek için hangi yol izlenecek. */
  kind: "docker" | "path";
  /** kind === "docker" ise prune kapsamı. */
  scope?: PruneScope;
  /** kind === "path" ise silinecek dosyalar (host yolları). */
  paths?: string[];
};

async function dirBytes(dir: string, filter?: (name: string) => boolean): Promise<{
  bytes: number;
  count: number;
  files: string[];
}> {
  let bytes = 0;
  let count = 0;
  const files: string[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (filter && !filter(entry.name)) continue;
      const full = path.posix.join(dir, entry.name);
      const info = await stat(full).catch(() => null);
      if (!info) continue;
      bytes += info.size;
      count += 1;
      files.push(full);
    }
  } catch {
    // Klasör yoksa ya da okunamıyorsa kalem 0 bayt olarak görünür.
  }

  return { bytes, count, files };
}

/** Bir klasörün toplam boyutu (özyinelemeli, sınırlı derinlik). */
async function treeBytes(dir: string, depth = 0): Promise<{ bytes: number; count: number }> {
  if (depth > 6) return { bytes: 0, count: 0 };

  let bytes = 0;
  let count = 0;
  try {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) {
        const sub = await treeBytes(full, depth + 1);
        bytes += sub.bytes;
        count += sub.count;
      } else if (entry.isFile()) {
        const info = await stat(full).catch(() => null);
        if (info) {
          bytes += info.size;
          count += 1;
        }
      }
    }
  } catch {
    // erişilemeyen alt ağaç atlanır
  }
  return { bytes, count };
}

function hostView(hostPath: string): string {
  return path.posix.join(hostRoot(), hostPath);
}

export async function scanCleanup(): Promise<{ items: CleanupItem[]; totalBytes: number }> {
  const items: CleanupItem[] = [];

  /* --- Docker --- */
  try {
    const provider = getDockerProvider();
    const [images, volumes, containers] = await Promise.all([
      provider.images(),
      provider.volumes(),
      provider.list(true),
    ]);

    const dangling = images.filter((image) => image.dangling);
    if (dangling.length > 0) {
      items.push({
        id: "docker-dangling",
        label: "Sarkan Docker image'ları",
        description:
          "Etiketi kalmamış ara katmanlar. Hiçbir container kullanmıyor; silmek güvenli.",
        bytes: dangling.reduce((sum, image) => sum + image.sizeBytes, 0),
        count: dangling.length,
        risk: "safe",
        kind: "docker",
        scope: "images-dangling",
      });
    }

    const unused = images.filter((image) => !image.dangling && image.usedBy.length === 0);
    if (unused.length > 0) {
      items.push({
        id: "docker-unused-images",
        label: "Kullanılmayan image'lar",
        description:
          "Hiçbir container'ın kullanmadığı etiketli image'lar. Geri almak yeniden indirmek demek — bağlantı yoksa can sıkıcı olur.",
        bytes: unused.reduce((sum, image) => sum + image.sizeBytes, 0),
        count: unused.length,
        risk: "caution",
        kind: "docker",
        scope: "images-unused",
      });
    }

    const stopped = containers.filter((container) => container.state !== "running");
    if (stopped.length > 0) {
      items.push({
        id: "docker-containers",
        label: "Durmuş container'lar",
        description: `Çalışmayan ${stopped.length} container: ${stopped
          .slice(0, 5)
          .map((container) => container.name)
          .join(", ")}${stopped.length > 5 ? "…" : ""}`,
        bytes: 0,
        count: stopped.length,
        risk: "caution",
        kind: "docker",
        scope: "containers",
      });
    }

    const orphanVolumes = volumes.filter((volume) => volume.usedBy.length === 0);
    if (orphanVolumes.length > 0) {
      items.push({
        id: "docker-volumes",
        label: "Kullanılmayan volume'lar",
        description:
          "DİKKAT: volume'lar VERİ tutar. Bir container geçici olarak durdurulmuşsa volume'ü 'kullanılmıyor' görünür ve silmek o verinin sonu olur.",
        bytes: 0,
        count: orphanVolumes.length,
        risk: "destructive",
        kind: "docker",
        scope: "volumes",
      });
    }

    items.push({
      id: "docker-build-cache",
      label: "Docker derleme önbelleği",
      description: "Image derlerken biriken ara katmanlar. Silmek yalnızca sonraki derlemeyi yavaşlatır.",
      bytes: 0,
      count: 0,
      risk: "safe",
      kind: "docker",
      scope: "build-cache",
    });
  } catch {
    // Docker erişilemiyorsa diğer kalemler yine listelenir.
  }

  /* --- Host dosyaları --- */

  const apt = await dirBytes(hostView("/var/cache/apt/archives"), (name) => name.endsWith(".deb"));
  if (apt.bytes > 0) {
    items.push({
      id: "apt-cache",
      label: "apt paket önbelleği",
      description: "İndirilmiş .deb dosyaları. Paketler zaten kurulu; bunlar yalnızca kopya.",
      bytes: apt.bytes,
      count: apt.count,
      risk: "safe",
      kind: "path",
      paths: apt.files.map((file) => file.slice(hostRoot().length)),
    });
  }

  const journal = await treeBytes(hostView("/var/log/journal"));
  if (journal.bytes > 0) {
    items.push({
      id: "journald",
      label: "journald arşivi",
      description:
        "Sistem günlükleri. Buradan silmek yerine 'journalctl --vacuum-size' tercih edilmeli — panel bu kalemi yalnızca RAPORLAR, silmez.",
      bytes: journal.bytes,
      count: journal.count,
      risk: "destructive",
      kind: "path",
      paths: [],
    });
  }

  const rotated = await collectRotatedLogs();
  if (rotated.bytes > 0) {
    items.push({
      id: "rotated-logs",
      label: "Döndürülmüş log dosyaları",
      description: "Sıkıştırılmış eski loglar (.gz, .1, .old). Güncel loglara dokunulmaz.",
      bytes: rotated.bytes,
      count: rotated.count,
      risk: "safe",
      kind: "path",
      paths: rotated.files,
    });
  }

  const migrationBackups = panelMigrationBackups();
  if (migrationBackups.bytes > 0) {
    items.push({
      id: "panel-migration-backups",
      label: "Panel migration yedekleri",
      description:
        "Şema güncellemelerinden önce alınan kopyalar. En yeni 3 tanesi her zaman korunur; bu kalem yalnızca fazlasını gösterir.",
      bytes: migrationBackups.bytes,
      count: migrationBackups.count,
      risk: "safe",
      kind: "path",
      // Panelin kendi volume'ü: geçici container'a gerek yok, doğrudan silinir.
      paths: [],
    });
  }

  return {
    items: items.sort((a, b) => b.bytes - a.bytes),
    totalBytes: items.reduce((sum, item) => sum + item.bytes, 0),
  };
}

const ROTATED = /\.(gz|xz|bz2|old)$|\.\d+$/;

async function collectRotatedLogs(): Promise<{ bytes: number; count: number; files: string[] }> {
  const base = hostView("/var/log");
  let bytes = 0;
  let count = 0;
  const files: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 3) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) {
        // journald ikili arşivi ayrı bir kalem; buradan silinmemeli.
        if (entry.name === "journal") continue;
        await walk(full, depth + 1);
      } else if (entry.isFile() && ROTATED.test(entry.name)) {
        const info = await stat(full).catch(() => null);
        if (!info) continue;
        bytes += info.size;
        count += 1;
        files.push(full.slice(hostRoot().length));
      }
    }
  }

  await walk(base, 0);
  return { bytes, count, files };
}

function panelMigrationBackups(): { bytes: number; count: number; files: string[] } {
  const dir = path.join(dataDir(), "backups");
  try {
    const entries = readdirSync(dir)
      .filter((name) => /^pre-migration-\d+\.db$/.test(name))
      .map((name) => ({ name, version: Number(name.replace(/\D/g, "")) }))
      .sort((a, b) => b.version - a.version)
      .slice(3);

    let bytes = 0;
    const files: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      bytes += statSync(full).size;
      files.push(full);
    }
    return { bytes, count: entries.length, files };
  } catch {
    return { bytes: 0, count: 0, files: [] };
  }
}

export type CleanupResult = { ok: boolean; message: string; reclaimedBytes: number };

export async function runCleanup(itemId: string): Promise<CleanupResult> {
  const { items } = await scanCleanup();
  const item = items.find((entry) => entry.id === itemId);
  if (!item) return { ok: false, message: "Bu kalem artık listede yok.", reclaimedBytes: 0 };

  if (item.kind === "docker" && item.scope) {
    const result = await getDockerProvider().prune(item.scope);
    return {
      ok: true,
      message: `${result.removed} öğe silindi.`,
      reclaimedBytes: result.reclaimedBytes,
    };
  }

  if (itemId === "panel-migration-backups") {
    const backups = panelMigrationBackups();
    for (const file of backups.files) rmSync(file, { force: true });
    return {
      ok: true,
      message: `${backups.count} eski migration yedeği silindi.`,
      reclaimedBytes: backups.bytes,
    };
  }

  if (itemId === "journald") {
    return {
      ok: false,
      message:
        "journald arşivi panelden silinmiyor. Host'ta: sudo journalctl --vacuum-size=200M",
      reclaimedBytes: 0,
    };
  }

  if (!item.paths || item.paths.length === 0) {
    return { ok: false, message: "Silinecek dosya bulunamadı.", reclaimedBytes: 0 };
  }

  /*
    Host dosyaları geçici container üzerinden siliniyor (panelin yazma yetkisi
    yok). ÜST KLASÖRE GÖRE GRUPLANIYOR: /var/log altında yüzlerce döndürülmüş
    log olabilir ve her biri için ayrı container açmak dakikalar sürerdi.
  */
  const byParent = new Map<string, string[]>();
  let reclaimed = 0;

  for (const file of item.paths) {
    try {
      reclaimed += statSync(hostView(file)).size;
    } catch {
      // Silinmeden önce kaybolmuş olabilir; boyut 0 sayılır.
    }
    const parent = path.posix.dirname(file);
    const bucket = byParent.get(parent);
    if (bucket) bucket.push(path.posix.basename(file));
    else byParent.set(parent, [path.posix.basename(file)]);
  }

  const failures: string[] = [];
  let removed = 0;

  for (const [parent, names] of byParent) {
    const outcome = await removeFilesIn(parent, names);
    if (outcome.ok) removed += names.length;
    else failures.push(`${parent}: ${outcome.message}`);
  }

  return {
    ok: failures.length === 0,
    message:
      `${removed} dosya silindi.` +
      (failures.length > 0 ? ` Silinemeyen: ${failures.slice(0, 2).join(" · ")}` : ""),
    reclaimedBytes: failures.length === 0 ? reclaimed : 0,
  };
}
