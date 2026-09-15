import "server-only";

import { panelImage } from "@/lib/host/self";
import { getDockerProvider } from "@/lib/providers";

/**
 * M3.5 — yükseltilmiş okuma.
 *
 * SORUN: panel container'ı bilinçli olarak yetkisiz bir kullanıcı (uid 1001)
 * olarak çalışıyor. Host kökü `/host/root` altına salt-okunur bağlı ama okuma
 * yine de normal Unix izinlerine tabi — `/home/coraspirin` (750, uid 1000)
 * panelden GÖRÜNMÜYOR. Sunucuda ölçüldü: `/etc` okunabiliyordu ama kullanıcının
 * kendi ev dizini "izin yok" veriyordu. Yazma işlemleri root container'dan
 * geçtiği için çalışıyordu; ortaya "yazabiliyor ama okuyamıyor" gibi tuhaf bir
 * durum çıkmıştı.
 *
 * ÇÖZÜM: okuma da, yazma gibi, tek seferlik bir container'a devrediliyor —
 * ama yalnızca doğrudan okuma izin hatası verdiğinde. Dünyaya açık yollar
 * (çoğu `/var/log`, `/etc`) hızlı yoldan okunmaya devam ediyor.
 *
 * YETKİ ARTIŞI YOK: `docker.sock` erişimi zaten host'ta root olmak demek
 * (docker-compose.yml'de yazıyor). Buradaki yükselme yeni bir kapı açmıyor,
 * panelin zaten sahip olduğu yetkiyi kullanılabilir hâle getiriyor.
 *
 * KOD SABİT, PARAMETRE ENV İLE: script bir dize sabiti; kullanıcıdan gelen yol
 * `TARGET` ortam değişkeniyle geçiyor. Yolu koda gömseydik dosya adındaki bir
 * tırnak işareti kod enjeksiyonuna dönüşürdü.
 */

const HOST_MOUNT = "/host/root";

/** Container içinde çalışacak sabit script. Çıktı: tek satır JSON. */
const SCRIPT = `
const fs = require("node:fs");
const path = require("node:path");
const op = process.env.OP;
const target = process.env.TARGET;
const limit = Number(process.env.LIMIT || "2000");

function entry(dir, name) {
  const full = path.join(dir, name);
  let info;
  try { info = fs.lstatSync(full); } catch { return null; }
  let link = null;
  if (info.isSymbolicLink()) { try { link = fs.readlinkSync(full); } catch {} }
  return {
    name,
    kind: info.isDirectory() ? "dir" : info.isSymbolicLink() ? "symlink" : info.isFile() ? "file" : "other",
    sizeBytes: info.size,
    modifiedAt: Math.floor(info.mtimeMs / 1000),
    mode: info.mode,
    uid: info.uid,
    gid: info.gid,
    linkTarget: link,
  };
}

function sizeOf(target, depth, deadline) {
  if (Date.now() > deadline || depth > 12) return 0;
  let info;
  try { info = fs.lstatSync(target); } catch { return 0; }
  if (info.isSymbolicLink()) return 0;
  if (!info.isDirectory()) return info.size;
  let total = 0;
  let children = [];
  try { children = fs.readdirSync(target); } catch { return 0; }
  for (const child of children) {
    total += sizeOf(path.join(target, child), depth + 1, deadline);
    if (Date.now() > deadline) break;
  }
  return total;
}

try {
  if (op === "list") {
    const names = fs.readdirSync(target);
    const entries = [];
    for (const name of names.slice(0, limit)) {
      const item = entry(target, name);
      if (item) entries.push(item);
    }
    console.log(JSON.stringify({ ok: true, entries, total: names.length }));
  } else if (op === "read") {
    const buffer = fs.readFileSync(target);
    console.log(JSON.stringify({
      ok: true,
      base64: buffer.subarray(0, limit).toString("base64"),
      sizeBytes: buffer.length,
    }));
  } else if (op === "usage") {
    const deadline = Date.now() + Number(process.env.BUDGET_MS || "20000");
    const names = fs.readdirSync(target);
    const entries = [];
    for (const name of names) {
      const full = path.join(target, name);
      let isDir = false;
      try { isDir = fs.statSync(full).isDirectory(); } catch {}
      entries.push({ name, isDir, bytes: sizeOf(full, 0, deadline) });
      if (Date.now() > deadline) break;
    }
    console.log(JSON.stringify({ ok: true, entries, timedOut: Date.now() > deadline }));
  } else {
    console.log(JSON.stringify({ ok: false, error: "bilinmeyen islem" }));
  }
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: String(error && error.message || error) }));
}
`;

type ElevatedResult = Record<string, unknown> & { ok: boolean; error?: string };

async function run(
  op: string,
  containerPath: string,
  extraEnv: Record<string, string> = {},
): Promise<ElevatedResult> {
  const image = await panelImage();
  if (!image) {
    return { ok: false, error: "Panel imajı belirlenemedi; yükseltilmiş okuma kullanılamıyor." };
  }

  const result = await getDockerProvider().runThrowaway({
    image,
    cmd: ["node", "-e", SCRIPT],
    binds: [`/:${HOST_MOUNT}:ro`],
    env: { OP: op, TARGET: containerPath, ...extraEnv },
    namePrefix: "panel-fsread",
    timeoutMs: 120_000,
    // Root: amacın kendisi bu — panel kullanıcısının göremediğini okumak.
    user: "0:0",
  });

  if (result.exitCode !== 0) {
    return { ok: false, error: result.output.slice(0, 300) || "okuma başarısız" };
  }

  // Script tek satır JSON yazıyor ama Node bazen uyarı satırı ekleyebiliyor;
  // son JSON satırı alınıyor.
  // stdout: Node uyarilari stderr'e gidiyor, JSON burada.
  const line = (result.stdout ?? result.output)
    .split("\n")
    .map((entry) => entry.trim())
    .reverse()
    .find((entry) => entry.startsWith("{"));

  if (!line) return { ok: false, error: "okuma çıktısı ayrıştırılamadı" };

  try {
    return JSON.parse(line) as ElevatedResult;
  } catch {
    return { ok: false, error: "okuma çıktısı geçerli JSON değil" };
  }
}

export type ElevatedEntry = {
  name: string;
  kind: "file" | "dir" | "symlink" | "other";
  sizeBytes: number;
  modifiedAt: number;
  mode: number;
  uid: number;
  gid: number;
  linkTarget: string | null;
};

export async function elevatedList(
  containerPath: string,
  limit: number,
): Promise<{ entries: ElevatedEntry[]; total: number } | { error: string }> {
  const result = await run("list", containerPath, { LIMIT: String(limit) });
  if (!result.ok) return { error: String(result.error ?? "okunamadı") };
  return {
    entries: (result.entries as ElevatedEntry[]) ?? [],
    total: Number(result.total ?? 0),
  };
}

export async function elevatedRead(
  containerPath: string,
  maxBytes: number,
): Promise<{ buffer: Buffer; sizeBytes: number } | { error: string }> {
  const result = await run("read", containerPath, { LIMIT: String(maxBytes) });
  if (!result.ok) return { error: String(result.error ?? "okunamadı") };
  return {
    buffer: Buffer.from(String(result.base64 ?? ""), "base64"),
    sizeBytes: Number(result.sizeBytes ?? 0),
  };
}

export async function elevatedUsage(
  containerPath: string,
  budgetMs: number,
): Promise<{ entries: { name: string; isDir: boolean; bytes: number }[]; timedOut: boolean } | { error: string }> {
  const result = await run("usage", containerPath, { BUDGET_MS: String(budgetMs) });
  if (!result.ok) return { error: String(result.error ?? "okunamadı") };
  return {
    entries: (result.entries as { name: string; isDir: boolean; bytes: number }[]) ?? [],
    timedOut: Boolean(result.timedOut),
  };
}

/** Erişim reddi mi — yükseltilmiş yola yalnızca bu durumda düşülüyor. */
export function isPermissionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("EACCES") || message.includes("EPERM");
}
