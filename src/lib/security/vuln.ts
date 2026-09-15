import "server-only";

import { announce } from "@/lib/alerts/announce";
import { getDb } from "@/lib/db/client";
import { getDockerProvider } from "@/lib/providers";
import { getBool, getNumber, getString } from "@/lib/settings";

/**
 * M3.8 — Docker image CVE taraması (Trivy).
 *
 * Trivy tek seferlik bir container'da çalışıyor (M3.4/M3.5 deseni). Kendi
 * veritabanını indirmesi gerekiyor ve bu ilk turda birkaç dakika sürebilir;
 * bu yüzden zaman aşımı ayrı bir ayar ve veritabanı bir named volume'de
 * kalıcı tutuluyor — her tarama 200 MB indirmesin.
 *
 * SONUÇ BİR YARGI DEĞİL BİR ENVANTER: "3 kritik CVE" demek "sunucu ele
 * geçirildi" demek değil. Çoğu CVE, o container'da hiç çalışmayan bir kod
 * yolunda. Panel bulguyu gösteriyor, kararı kullanıcı veriyor.
 */

const TRIVY_CACHE_VOLUME = "panel-trivy-cache";

export type Finding = {
  id: string;
  severity: string;
  package: string;
  installed: string;
  fixed: string;
  title: string;
};

export type ScanRow = {
  id: number;
  ts: number;
  image: string;
  ok: boolean;
  critical: number;
  high: number;
  medium: number;
  low: number;
  findings: Finding[];
  durationMs: number;
  error: string;
};

type TrivyOutput = {
  Results?: {
    Vulnerabilities?: {
      VulnerabilityID?: string;
      Severity?: string;
      PkgName?: string;
      InstalledVersion?: string;
      FixedVersion?: string;
      Title?: string;
    }[];
  }[];
};

/**
 * Trivy'nin çıktısını insan diline çevirir.
 *
 * "blobs/sha256/... not found in tar": Trivy imajı Docker daemon'dan okurken
 * bazı çok katmanlı büyük imajlarda tar akışı eksik geliyor. Bu bir disk ya da
 * yapılandırma sorunu değil, Trivy–Docker arasındaki bilinen bir sınır.
 * Ham yığın izini kullanıcıya göstermek hiçbir şey anlatmıyor.
 */
function explain(raw: string, image: string): string {
  if (raw.includes("not found in tar") || raw.includes("unable to populate")) {
    return (
      `Trivy bu imajı Docker'dan okuyamadı (büyük, çok katmanlı imajlarda görülen bilinen bir sınır): ${image}. ` +
      "Ayarlarda 'kayıt defterinden oku' seçeneğini açarak deneyebilirsin — imajı yeniden indirir, uzun sürer."
    );
  }
  if (raw.includes("no space left")) {
    return "Diskte yer kalmadı; tarama tamamlanamadı.";
  }
  return raw.slice(0, 600);
}

export async function scanImage(image: string): Promise<ScanRow> {
  const started = Date.now();
  const scanner = getString("security.trivy_image");
  const remote = getBool("security.trivy_remote");

  try {
    const result = await getDockerProvider().runThrowaway({
      image: scanner,
      cmd: [
        "image",
        // Kaynak seçimi: varsayılan Docker daemon (hızlı, imaj zaten yerelde).
        // "remote" imajı kayıt defterinden yeniden indirir — yavaş ama
        // daemon'dan okunamayan imajlarda tek yol.
        ...(remote ? ["--image-src", "remote"] : []),
        "--format",
        "json",
        // Yalnızca düzeltmesi OLAN açıklar: düzeltilemeyen bir CVE için
        // yapılacak bir şey yok ve listeyi doldurup gerçek işi gizliyor.
        "--ignore-unfixed",
        "--severity",
        "CRITICAL,HIGH,MEDIUM",
        "--scanners",
        "vuln",
        "--quiet",
        image,
      ],
      binds: [
        "/var/run/docker.sock:/var/run/docker.sock",
        `${TRIVY_CACHE_VOLUME}:/root/.cache`,
      ],
      env: {
        /*
          Geçici dosyalar container'ın yazma katmanına DEĞİL, kalıcı volume'e
          yazılıyor. Sebep sunucuda görüldü: Home Assistant imajı 3,4 GB ve
          Trivy katmanları açarken container'ın geçici alanında yer bulamayıp
          "unable to populate ... temporary file" ile düşüyordu. Volume host
          diskinde ve orada yer var.
        */
        TMPDIR: "/root/.cache",
      },
      namePrefix: "panel-trivy",
      timeoutMs: getNumber("security.scan_timeout_minutes") * 60_000,
      user: "0:0",
    });

    if (result.exitCode !== 0) {
      return record({
        image,
        ok: false,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        findings: [],
        durationMs: Date.now() - started,
        error: explain(result.output, image) || `trivy çıkış kodu ${result.exitCode}`,
      });
    }

    // Yalnızca stdout: Trivy günlüğünü stderr'e yazıyor ve birleştirilmiş
    // çıktıda JSON ayrıştırılamıyor.
    const json = extractJson(result.stdout ?? result.output);
    if (!json) {
      return record({
        image,
        ok: false,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        findings: [],
        durationMs: Date.now() - started,
        error: "trivy çıktısı ayrıştırılamadı",
      });
    }

    const parsed = JSON.parse(json) as TrivyOutput;
    const findings: Finding[] = [];
    const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 } as Record<string, number>;

    for (const group of parsed.Results ?? []) {
      for (const vuln of group.Vulnerabilities ?? []) {
        const severity = String(vuln.Severity ?? "UNKNOWN").toUpperCase();
        counts[severity] = (counts[severity] ?? 0) + 1;

        // Yalnızca en ciddi olanlar saklanıyor: bir image yüzlerce orta
        // seviyeli bulgu üretebiliyor ve hepsini saklamak veritabanını
        // faydasız yere şişiriyor.
        if (severity === "CRITICAL" || severity === "HIGH") {
          findings.push({
            id: String(vuln.VulnerabilityID ?? ""),
            severity,
            package: String(vuln.PkgName ?? ""),
            installed: String(vuln.InstalledVersion ?? ""),
            fixed: String(vuln.FixedVersion ?? ""),
            title: String(vuln.Title ?? "").slice(0, 200),
          });
        }
      }
    }

    return record({
      image,
      ok: true,
      critical: counts.CRITICAL ?? 0,
      high: counts.HIGH ?? 0,
      medium: counts.MEDIUM ?? 0,
      low: counts.LOW ?? 0,
      findings: findings.slice(0, 100),
      durationMs: Date.now() - started,
      error: "",
    });
  } catch (error) {
    return record({
      image,
      ok: false,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      findings: [],
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : "tarama başarısız",
    });
  }
}

function record(input: Omit<ScanRow, "id" | "ts">): ScanRow {
  const info = getDb()
    .prepare(
      `INSERT INTO vuln_scans
         (image, ok, critical, high, medium, low, findings, duration_ms, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.image,
      input.ok ? 1 : 0,
      input.critical,
      input.high,
      input.medium,
      input.low,
      JSON.stringify(input.findings),
      input.durationMs,
      input.error,
    );

  return { ...input, id: Number(info.lastInsertRowid), ts: Math.floor(Date.now() / 1000) };
}

/** Her image için EN SON tarama. Geçmiş tabloda kalıyor ama ekranda güncel hâl var. */
export function latestScans(): ScanRow[] {
  return (
    getDb()
      .prepare(
        `SELECT s.* FROM vuln_scans s
         JOIN (SELECT image, MAX(ts) AS ts FROM vuln_scans GROUP BY image) latest
           ON latest.image = s.image AND latest.ts = s.ts
         ORDER BY s.critical DESC, s.high DESC, s.image`,
      )
      .all() as Record<string, string | number>[]
  ).map((row) => ({
    id: Number(row.id),
    ts: Number(row.ts),
    image: String(row.image),
    ok: Number(row.ok) === 1,
    critical: Number(row.critical),
    high: Number(row.high),
    medium: Number(row.medium),
    low: Number(row.low),
    findings: parseFindings(String(row.findings)),
    durationMs: Number(row.duration_ms),
    error: String(row.error ?? ""),
  }));
}

function parseFindings(raw: string): Finding[] {
  try {
    return JSON.parse(raw) as Finding[];
  } catch {
    return [];
  }
}

/**
 * Kullanımdaki tüm image'ları tarar.
 *
 * Yalnızca ÇALIŞAN container'ların image'ları: kullanılmayan bir image'ın
 * açığı, o image çalışmadığı sürece bir risk değil ve tarama süresi image
 * sayısıyla doğrusal artıyor.
 */
export async function scanAllImages(): Promise<{ scanned: number; critical: number; detail: string }> {
  const provider = getDockerProvider();
  let containers;
  try {
    containers = await provider.list(false);
  } catch (error) {
    return {
      scanned: 0,
      critical: 0,
      detail: `docker listesi alınamadı: ${error instanceof Error ? error.message : "?"}`,
    };
  }

  const images = [...new Set(containers.map((container) => container.image))];
  const previous = new Map(latestScans().map((scan) => [scan.image, scan]));

  let critical = 0;
  const problems: string[] = [];
  const newlyCritical: string[] = [];

  for (const image of images) {
    const scan = await scanImage(image);
    if (!scan.ok) {
      problems.push(`${image}: ${scan.error.slice(0, 80)}`);
      continue;
    }
    critical += scan.critical;

    // Alarm YALNIZCA yeni kritik bulgu için: her turda aynı CVE'yi bildirmek
    // bildirimi gürültüye çevirir ve gerçekten yeni olanı gizler.
    const before = previous.get(image);
    if (scan.critical > 0 && (before === undefined || scan.critical > before.critical)) {
      newlyCritical.push(`${image} (${scan.critical} kritik)`);
    }
  }

  if (newlyCritical.length > 0) {
    await announce({
      alertKey: "security.cve",
      source: "system",
      severity: "warning",
      title: "Yeni kritik güvenlik açığı bulundu",
      detail:
        `${newlyCritical.join(", ")}\n` +
        "Panel → Güvenlik ekranında ayrıntılar var. Çoğu açık image güncellemesiyle kapanır.",
    });
  }

  return {
    scanned: images.length,
    critical,
    detail:
      `${images.length} image tarandı, ${critical} kritik bulgu` +
      (problems.length > 0 ? ` · hata: ${problems.join("; ")}` : ""),
  };
}

export function pruneScans(keepDays: number): number {
  if (keepDays <= 0) return 0;
  return Number(
    getDb()
      .prepare("DELETE FROM vuln_scans WHERE ts < unixepoch() - ?")
      .run(keepDays * 86400).changes,
  );
}

function extractJson(output: string): string | null {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  return start >= 0 && end > start ? output.slice(start, end + 1) : null;
}
