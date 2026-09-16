import "server-only";
import { serverT } from "@/lib/i18n/runtime";

import { announce } from "@/lib/alerts/announce";
import { callHelper, helperConfigured } from "@/lib/host/helper";
import { getDockerProvider } from "@/lib/providers";
import { getBool, getNumber, getString } from "@/lib/settings";
import {
  forgetSource,
  insertLines,
  listPatterns,
  listSources,
  markPatternHit,
  readCursor,
  writeCursor,
  type IncomingLine,
} from "./store";
import type { LogLevel } from "./types";

/**
 * M3.3 — log toplayıcı.
 *
 * Faz 1'deki canlı SSE akışı (M1.7) "şu anda ne oluyor" sorusunu cevaplıyor ve
 * hiçbir şey saklamıyor. Burada amaç tam tersi: dün gece 03:00'te ne olduğunu
 * bugün arayabilmek. Bu yüzden akış değil periyodik çekme kullanılıyor —
 * kalıcı bir akış bağlantısı, panel yeniden başladığında aradaki satırları
 * sessizce kaybederdi.
 */

const MAX_LINE_LENGTH = 8000;

/** Kaynak seçimi: virgüllü liste. Boşsa çalışan tüm container'lar. */
function selectedSources(): string[] {
  return getString("logs.sources")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export type CollectOutcome = {
  collected: number;
  sources: number;
  skipped: string[];
  errors: string[];
  matched: number;
};

export async function collectLogs(): Promise<CollectOutcome> {
  const outcome: CollectOutcome = {
    collected: 0,
    sources: 0,
    skipped: [],
    errors: [],
    matched: 0,
  };

  if (!getBool("logs.enabled")) {
    outcome.skipped.push(serverT("logCollect.disabled"));
    return outcome;
  }

  const fresh: IncomingLine[] = [];
  fresh.push(...(await collectContainers(outcome)));
  fresh.push(...(await collectJournald(outcome)));

  if (fresh.length > 0) {
    insertLines(fresh);
    outcome.collected = fresh.length;
    outcome.matched = await matchPatterns(fresh);
  }

  return outcome;
}

async function collectContainers(outcome: CollectOutcome): Promise<IncomingLine[]> {
  const provider = getDockerProvider();
  const perSource = getNumber("logs.max_lines_per_source");
  const wanted = selectedSources();
  const lines: IncomingLine[] = [];

  let containers;
  try {
    containers = await provider.list(false);
  } catch (error) {
    outcome.errors.push(serverT("logCollect.dockerList", { error: message(error) }));
    return lines;
  }

  const running = new Set(containers.map((container) => container.name));
  const targets = containers.filter(
    (container) => wanted.length === 0 || wanted.includes(container.name),
  );

  // Panelin kendi logları toplanmıyor: her toplama turu kendi satırlarını
  // yazar, o satırlar bir sonraki turda toplanır ve sistem kendi kuyruğunu
  // yiyerek büyür.
  const own = process.env.PANEL_CONTAINER_NAME ?? "server-panel-panel-1";

  for (const container of targets) {
    if (container.name === own) continue;

    const since = readCursor(container.name);
    let newest = since;
    let count = 0;

    try {
      const controller = new AbortController();
      const stream = provider.logs(container.id, {
        // İmleç bir saniye ileriden veriliyor (Docker `since`'ı dahil kabul
        // eder); ilk turda ise geriye dönük olarak son N satır alınır.
        tail: since === 0 ? perSource : 0,
        follow: false,
        signal: controller.signal,
        since: since === 0 ? undefined : since + 1,
      });

      for await (const line of stream) {
        if (count >= perSource) {
          controller.abort();
          break;
        }
        const text = line.text.trim();
        if (text.length === 0) continue;

        const ts = line.ts ? Math.floor(new Date(line.ts).getTime() / 1000) : 0;
        if (!Number.isFinite(ts) || ts <= 0) continue;

        lines.push({
          ts,
          source: container.name,
          kind: "container",
          stream: line.stream,
          message: text.slice(0, MAX_LINE_LENGTH),
        });
        if (ts > newest) newest = ts;
        count += 1;
      }

      writeCursor(container.name, "container", newest, count);
      outcome.sources += 1;
    } catch (error) {
      writeCursor(container.name, "container", newest, count, message(error));
      outcome.errors.push(`${container.name}: ${message(error)}`);
    }
  }

  // Silinmiş bir container'ın imleci kaynak listesinde sonsuza kadar
  // durmasın. Yalnızca hiç satırı KALMAMIŞ olanlar unutuluyor: logları hâlâ
  // aranabilen bir kaynağı listeden düşürmek, o satırları görünmez yapardı.
  for (const info of listSources()) {
    if (info.kind === "container" && !running.has(info.source) && info.lines === 0) {
      forgetSource(info.source);
    }
  }

  return lines;
}

/* --- journald --- */

const JOURNAL_PRIORITY: Record<string, LogLevel> = {
  "0": "error",
  "1": "error",
  "2": "error",
  "3": "error",
  "4": "warning",
  "5": "info",
  "6": "info",
  "7": "debug",
};

async function collectJournald(outcome: CollectOutcome): Promise<IncomingLine[]> {
  if (!getBool("logs.journald_enabled")) return [];

  if (!helperConfigured()) {
    outcome.skipped.push(serverT("logCollect.noHelper"));
    return [];
  }

  const since = readCursor("journald");
  const perSource = getNumber("logs.max_lines_per_source");
  const lines: IncomingLine[] = [];
  let newest = since;

  try {
    const response = await callHelper(
      "journal.read",
      {
        // İlk turda geçmişe gitmenin anlamı yok; journald zaten diskte duruyor
        // ve tümünü kopyalamak veritabanını gereksiz şişirir.
        sinceSeconds: since === 0 ? 3600 : Math.max(60, Math.floor(Date.now() / 1000) - since),
        lines: perSource,
      },
      // Toplama zamanlanmış bir iş; bir kullanıcı adına değil panelin kendi
      // adına çalışıyor. Helper bunu kendi tarafında böyle loglar.
      { username: "panel-job", userId: 0 },
    );

    if (!response.ok) {
      // İzin listesinde yoksa bu bir arıza değil, bir yapılandırma eksiği.
      outcome.skipped.push(`journald: ${response.error ?? "helper reddetti"}`);
      writeCursor("journald", "journald", newest, 0, response.error ?? "helper reddetti");
      return [];
    }

    for (const raw of (response.stdout ?? "").split("\n")) {
      if (raw.trim().length === 0) continue;

      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        continue;
      }

      // journald mikrosaniye cinsinden yazar.
      const ts = Math.floor(Number(entry.__REALTIME_TIMESTAMP ?? 0) / 1_000_000);
      if (!Number.isFinite(ts) || ts <= 0 || ts <= since) continue;

      const text = String(entry.MESSAGE ?? "").trim();
      if (text.length === 0) continue;

      lines.push({
        ts,
        source: String(entry._SYSTEMD_UNIT ?? entry.SYSLOG_IDENTIFIER ?? "journald"),
        kind: "journald",
        stream: String(entry.PRIORITY ?? ""),
        level: JOURNAL_PRIORITY[String(entry.PRIORITY ?? "6")] ?? "info",
        message: text.slice(0, MAX_LINE_LENGTH),
      });
      if (ts > newest) newest = ts;
    }

    writeCursor("journald", "journald", newest, lines.length);
    outcome.sources += 1;
  } catch (error) {
    outcome.errors.push(`journald: ${message(error)}`);
    writeCursor("journald", "journald", newest, 0, message(error));
  }

  return lines;
}

/* --- Desen eşleştirme --- */

/**
 * Yeni satırlar kurallara karşı sınanır. Eşleşen her kural için EN FAZLA bir
 * olay üretilir ve bekleme süresi dolana kadar tekrar üretilmez: bir OOM
 * döngüsü dakikada yüzlerce satır yazabilir ve hepsi bildirilse telefon
 * kullanılamaz hâle gelir.
 */
async function matchPatterns(lines: IncomingLine[]): Promise<number> {
  const patterns = listPatterns().filter((pattern) => pattern.enabled);
  if (patterns.length === 0) return 0;

  const now = Math.floor(Date.now() / 1000);
  let fired = 0;

  for (const pattern of patterns) {
    if (
      pattern.lastHitAt !== null &&
      now - pattern.lastHitAt < pattern.cooldownMinutes * 60
    ) {
      continue;
    }

    let test: (message: string) => boolean;
    if (pattern.isRegex) {
      let regex: RegExp;
      try {
        regex = new RegExp(pattern.pattern, "i");
      } catch {
        // Bozuk desen tüm toplamayı düşürmemeli; kural atlanır.
        continue;
      }
      test = (message) => regex.test(message);
    } else {
      const needle = pattern.pattern.toLowerCase();
      test = (message) => message.toLowerCase().includes(needle);
    }

    const hits = lines.filter(
      (line) =>
        (pattern.sourceFilter === "" || line.source === pattern.sourceFilter) &&
        test(line.message),
    );
    if (hits.length === 0) continue;

    const first = hits[0];
    const sources = [...new Set(hits.map((hit) => hit.source))];

    markPatternHit(pattern.id, now);
    fired += 1;

    await announce({
      alertKey: `log.pattern.${pattern.id}`,
      source: "system",
      severity: pattern.severity,
      title: serverT("logCollect.matchTitle", { name: pattern.name }),
      detail: serverT("logCollect.matchDetail", {
        count: hits.length,
        sources: sources.join(", "),
        first: first.message.slice(0, 300),
      }),
    });
  }

  return fired;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
