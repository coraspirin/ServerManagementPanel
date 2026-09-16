import "server-only";
import { serverT } from "@/lib/i18n/runtime";

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/db/client";

/**
 * M2.9 — MAC → üretici çözümlemesi.
 *
 * IEEE'nin OUI listesi indirilip `data/oui.csv` olarak saklanıyor ve belleğe
 * alınıyor. İmaja gömülmedi: ~2 MB'lık bir dosya her panel güncellemesinde
 * yeniden taşınırdı ve liste ayda bir değişiyor.
 *
 * İnternet yoksa üretici alanı boş kalır — bu bir hata değil, eksik bir
 * süstür. Cihazın kendisi yine listelenir.
 */

const SOURCE_URL = "https://standards-oui.ieee.org/oui/oui.csv";
const MAX_AGE_DAYS = 60;
const TIMEOUT_MS = 60_000;

let table: Map<string, string> | null = null;

function ouiPath(): string {
  return path.join(dataDir(), "oui.csv");
}

function load(): Map<string, string> {
  if (table) return table;

  const map = new Map<string, string>();
  try {
    const text = readFileSync(ouiPath(), "utf8");
    for (const line of text.split("\n")) {
      // Biçim: Registry,Assignment,Organization Name,Organization Address
      const match = /^MA-L,([0-9A-F]{6}),"?([^",]+)/i.exec(line);
      if (match) map.set(match[1].toUpperCase(), match[2].trim());
    }
  } catch {
    // Dosya yok ya da okunamıyor; boş tabloyla devam.
  }

  table = map;
  return map;
}

export function vendorOf(mac: string): string {
  const prefix = mac.replace(/[^0-9a-f]/gi, "").slice(0, 6).toUpperCase();
  return load().get(prefix) ?? "";
}

/** Liste var mı ve ne kadar eski. */
export function ouiStatus(): { present: boolean; ageDays: number | null; entries: number } {
  const file = ouiPath();
  if (!existsSync(file)) return { present: false, ageDays: null, entries: 0 };

  const { mtimeMs } = statSync(file);
  return {
    present: true,
    ageDays: Math.floor((Date.now() - mtimeMs) / 86_400_000),
    entries: load().size,
  };
}

/**
 * Listeyi indirir. `force` değilse yalnızca yoksa ya da eskiyse indirir.
 *
 * Sonuç `data/` altına yazılıyor: panel-data kalıcı volume, yani panel
 * güncellenince yeniden indirmek gerekmiyor.
 */
export async function refreshOui(force = false): Promise<{ updated: boolean; message: string }> {
  const status = ouiStatus();
  if (!force && status.present && (status.ageDays ?? 0) < MAX_AGE_DAYS) {
    return { updated: false, message: serverT("ouiLib.current", { count: status.entries }) };
  }

  try {
    const response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const text = await response.text();
    // Kısa bir yanıt neredeyse kesin bir hata sayfasıdır; onu kaydedip
    // "liste var" sanmak, üreticilerin sessizce boş kalmasına yol açardı.
    if (text.length < 100_000) throw new Error(serverT("ouiLib.tooSmall"));

    writeFileSync(ouiPath(), text, "utf8");
    table = null;
    return { updated: true, message: serverT("ouiLib.downloaded", { count: load().size }) };
  } catch (error) {
    return {
      updated: false,
      message: serverT("oui.downloadFailed", { error: error instanceof Error ? error.message : String(error) }),
    };
  }
}
