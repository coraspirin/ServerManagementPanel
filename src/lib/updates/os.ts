import { readFile } from "node:fs/promises";
import path from "node:path";
import { getNumber } from "@/lib/settings";
import { isMockMode } from "@/lib/env";
import { loadFixture } from "@/lib/fixtures";
import { onHost } from "@/lib/hosts/on-host";

/**
 * İşletim sistemi güncelleme raporu (M1.10).
 *
 * Raporu host'ta çalışan `scripts/os-updates.sh` üretir; panel yalnızca okur
 * (gerekçe scriptin başında yazılı: `apt` host'un paket veritabanını ister ve
 * root ile çalışır). Rapor hiç yoksa panel "kurulum yapılmamış" der — boş bir
 * "0 güncelleme" göstermek, kontrol edilmediğini gizlerdi.
 */

const REPORTS_DIR = process.env.REPORTS_DIR ?? "/app/reports";

export type OsPackage = {
  name: string;
  current: string | null;
  candidate: string;
  security: boolean;
};

export type OsUpdateReport = {
  /** Rapor dosyası hiç üretilmemişse false — kurulum talimatı gösterilir. */
  available: boolean;
  reportedAt: number | null;
  total: number;
  security: number;
  rebootRequired: boolean;
  packages: OsPackage[];
  errors: string[];
  /** Rapor ayardaki süreden eskiyse true. */
  stale: boolean;
};

const EMPTY: OsUpdateReport = {
  available: false,
  reportedAt: null,
  total: 0,
  security: 0,
  rebootRequired: false,
  packages: [],
  errors: [],
  stale: false,
};

/** Seçili sunucunun raporu; uzak sunucuda ajan okur (rapor o sunucuda üretiliyor). */
export function osUpdateReport(): Promise<OsUpdateReport> {
  return onHost("updates.osReport", [], localOsUpdateReport);
}

export async function localOsUpdateReport(): Promise<OsUpdateReport> {
  const raw = isMockMode()
    ? await loadFixture<Omit<OsUpdateReport, "available" | "stale">>("os-updates").catch(() => null)
    : await readFile(path.join(REPORTS_DIR, "os-updates.json"), "utf8")
        .then((text) => JSON.parse(text) as Omit<OsUpdateReport, "available" | "stale">)
        .catch(() => null);

  if (!raw) return EMPTY;

  const staleHours = getNumber("updates.report_stale_hours");
  const age = raw.reportedAt ? Math.floor(Date.now() / 1000) - raw.reportedAt : null;

  return {
    available: true,
    reportedAt: raw.reportedAt ?? null,
    total: raw.total ?? 0,
    security: raw.security ?? 0,
    rebootRequired: raw.rebootRequired === true,
    packages: raw.packages ?? [],
    errors: raw.errors ?? [],
    stale: age === null || age > staleHours * 3600,
  };
}
