import "server-only";

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/db/client";

/**
 * M2.2 — yüklenen kart logoları.
 *
 * Dosyalar `data/logos` altında, veritabanında değil: SQLite'a ikili veri
 * koymak yedeği ve WAL'ı gereksiz yere şişirir. `data` zaten kalıcı volume
 * (docker-compose'daki `panel-data`), yani logolar da yedeğe dahil.
 */

const MAX_BYTES = 512 * 1024;

/**
 * Kabul edilen türler ve gerçek imzaları.
 *
 * `Content-Type` başlığına GÜVENİLMİYOR: onu istemci yazar. Dosyanın ilk
 * baytlarına bakmak, ".png" adıyla gönderilen bir HTML/JS dosyasının panel
 * kökünden servis edilmesini engeller.
 */
const TYPES: { ext: string; mime: string; matches: (bytes: Buffer) => boolean }[] = [
  {
    ext: "png",
    mime: "image/png",
    matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    ext: "jpg",
    mime: "image/jpeg",
    matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    ext: "gif",
    mime: "image/gif",
    matches: (b) => b.subarray(0, 6).toString("ascii").startsWith("GIF8"),
  },
  {
    ext: "webp",
    mime: "image/webp",
    matches: (b) =>
      b.subarray(0, 4).toString("ascii") === "RIFF" &&
      b.subarray(8, 12).toString("ascii") === "WEBP",
  },
  {
    ext: "ico",
    mime: "image/x-icon",
    matches: (b) => b[0] === 0x00 && b[1] === 0x00 && (b[2] === 0x01 || b[2] === 0x02),
  },
  {
    // SVG metin tabanlı, imzası yok; `<svg` geçmesi yeterli sayılıyor.
    // ⚠️ SVG script taşıyabilir — bu yüzden servis edilirken sandbox CSP ve
    //    nosniff başlıkları ZORUNLU (bkz. logo route'u).
    ext: "svg",
    mime: "image/svg+xml",
    matches: (b) => b.subarray(0, 1024).toString("utf8").toLowerCase().includes("<svg"),
  },
];

export function logoDir(): string {
  return path.join(dataDir(), "logos");
}

export type SaveResult = { ok: true; name: string } | { ok: false; error: string };

export function saveLogo(bytes: Buffer): SaveResult {
  if (bytes.byteLength === 0) return { ok: false, error: "dosya boş" };
  if (bytes.byteLength > MAX_BYTES) {
    return { ok: false, error: `logo en fazla ${MAX_BYTES / 1024} KB olabilir` };
  }

  const type = TYPES.find((candidate) => candidate.matches(bytes));
  if (!type) {
    return { ok: false, error: "desteklenmeyen dosya türü (PNG, JPEG, GIF, WebP, ICO, SVG)" };
  }

  // Ad tamamen panelde üretiliyor; kullanıcının verdiği ad hiç kullanılmıyor.
  // Dizin gezme (`../`) ve çakışma sorunlarının ikisi de böylece doğmuyor.
  const name = `${randomBytes(12).toString("hex")}.${type.ext}`;
  mkdirSync(logoDir(), { recursive: true });
  writeFileSync(path.join(logoDir(), name), bytes);

  return { ok: true, name };
}

export type StoredLogo = { bytes: Buffer; mime: string };

export function readLogo(name: string): StoredLogo | null {
  // Ad daima `<hex>.<ext>`; bu desene uymayan hiçbir şey diske çevrilmiyor.
  const match = /^([0-9a-f]{24})\.([a-z]+)$/.exec(name);
  if (!match) return null;

  const type = TYPES.find((candidate) => candidate.ext === match[2]);
  if (!type) return null;

  const file = path.join(logoDir(), name);
  if (!existsSync(file)) return null;

  return { bytes: readFileSync(file), mime: type.mime };
}

/**
 * Kart silinince ya da logosu değişince dosyayı temizler.
 *
 * Sessizce başarısız oluyor: dosya zaten yoksa ya da silinemiyorsa kartın
 * silinmesi engellenmemeli — artakalan bir dosya, yarım kalmış bir silmeden
 * çok daha ucuz.
 */
export function deleteLogo(icon: string): void {
  if (!icon.startsWith("upload:")) return;
  const name = icon.slice(7);
  if (!/^[0-9a-f]{24}\.[a-z]+$/.test(name)) return;

  try {
    unlinkSync(path.join(logoDir(), name));
  } catch {
    // yoksa da olur
  }
}
