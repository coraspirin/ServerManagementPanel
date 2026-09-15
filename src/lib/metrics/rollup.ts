import "server-only";

import { getDb } from "@/lib/db/client";
import { getNumber } from "@/lib/settings";

/**
 * T1 — katmanlı toplama (rollup) ve budama.
 *
 * Ham veri 1 dk → 1 sa → 1 gün kovalarına toplanır. Her katman bir öncekinden
 * beslenir; ortalama alınırken `sample_count` ile AĞIRLIKLANDIRILIR, yoksa
 * eksik örnek içeren bir kova diğerleriyle eşit sayılıp sonucu bozardı.
 *
 * Yalnızca TAMAMLANMIŞ kovalar işlenir: üst sınır her zaman içinde bulunulan
 * kovanın başlangıcıdır (hariç). Böylece yarım kova yazılıp sonra düzeltilmek
 * zorunda kalınmaz.
 *
 * Saklama süreleri koda yazılmaz; her tur ayarlardan okunur (T9). Kullanıcı
 * süreyi kısaltırsa fazla veri bir sonraki turda silinir.
 */

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

type Counts = Record<string, number>;

function maxTs(table: string): number | null {
  const row = getDb().prepare(`SELECT MAX(ts) AS ts FROM ${table}`).get() as
    | { ts: number | null }
    | undefined;
  return row?.ts ?? null;
}

function minTs(table: string): number | null {
  const row = getDb().prepare(`SELECT MIN(ts) AS ts FROM ${table}`).get() as
    | { ts: number | null }
    | undefined;
  return row?.ts ?? null;
}

/** Ham örneklerden bir katman üretir. */
function rollupFromRaw(target: string, bucket: number, now: number): number {
  // Hedefteki son kovadan devam et; hedef boşsa ham verinin başından.
  const start = maxTs(target) ?? minTs("metrics_raw");
  if (start === null) return 0;

  const end = Math.floor(now / bucket) * bucket;
  if (start >= end) return 0;

  const result = getDb()
    .prepare(
      `INSERT OR REPLACE INTO ${target}
         (host_id, metric, label, ts, avg_value, min_value, max_value, sample_count)
       SELECT host_id, metric, label, (ts / ${bucket}) * ${bucket},
              AVG(value), MIN(value), MAX(value), COUNT(*)
       FROM metrics_raw
       WHERE ts >= ? AND ts < ?
       GROUP BY host_id, metric, label, (ts / ${bucket}) * ${bucket}`,
    )
    .run(start, end);

  return Number(result.changes);
}

/** Daha ince bir katmandan daha kaba bir katman üretir. */
function rollupFromTier(source: string, target: string, bucket: number, now: number): number {
  const start = maxTs(target) ?? minTs(source);
  if (start === null) return 0;

  const end = Math.floor(now / bucket) * bucket;
  if (start >= end) return 0;

  const result = getDb()
    .prepare(
      `INSERT OR REPLACE INTO ${target}
         (host_id, metric, label, ts, avg_value, min_value, max_value, sample_count)
       SELECT host_id, metric, label, (ts / ${bucket}) * ${bucket},
              SUM(avg_value * sample_count) / SUM(sample_count),
              MIN(min_value), MAX(max_value), SUM(sample_count)
       FROM ${source}
       WHERE ts >= ? AND ts < ?
       GROUP BY host_id, metric, label, (ts / ${bucket}) * ${bucket}`,
    )
    .run(start, end);

  return Number(result.changes);
}

function pruneTable(table: string, olderThan: number): number {
  const result = getDb().prepare(`DELETE FROM ${table} WHERE ts < ?`).run(olderThan);
  return Number(result.changes);
}

/**
 * Toplama aralığı 60 sn veya daha uzunsa `metrics_1m` ham veriyle birebir aynı
 * olur — kopya tablo üretmenin anlamı yok. Bu durumda 1 saatlik katman doğrudan
 * ham veriden hesaplanır (T1).
 */
function skipMinuteTier(): boolean {
  return getNumber("monitoring.collect_interval") >= MINUTE;
}

export function runRollup(): { rolled: Counts; pruned: Counts; detail: string } {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const skip1m = skipMinuteTier();

  const rolled: Counts = {};
  const pruned: Counts = {};

  db.exec("BEGIN IMMEDIATE");
  try {
    if (skip1m) {
      rolled["1s"] = rollupFromRaw("metrics_1h", HOUR, now);
    } else {
      rolled["1dk"] = rollupFromRaw("metrics_1m", MINUTE, now);
      rolled["1s"] = rollupFromTier("metrics_1m", "metrics_1h", HOUR, now);
    }
    rolled["1g"] = rollupFromTier("metrics_1h", "metrics_1d", DAY, now);

    // Saklama süreleri ayarlardan (T9). Ay = 30 gün kabul edilir; takvim ayı
    // hassasiyeti budama için gereksiz, sınır zaten kullanıcı tercihi.
    pruned["ham"] = pruneTable(
      "metrics_raw",
      now - getNumber("monitoring.retention.raw_hours") * HOUR,
    );
    pruned["1dk"] = pruneTable(
      "metrics_1m",
      now - getNumber("monitoring.retention.minute_days") * DAY,
    );
    pruned["1s"] = pruneTable(
      "metrics_1h",
      now - getNumber("monitoring.retention.hour_days") * DAY,
    );
    pruned["1g"] = pruneTable(
      "metrics_1d",
      now - getNumber("monitoring.retention.day_months") * 30 * DAY,
    );

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const summarize = (counts: Counts) =>
    Object.entries(counts)
      .filter(([, n]) => n > 0)
      .map(([tier, n]) => `${tier}:${n}`)
      .join(" ");

  const rolledText = summarize(rolled) || "yeni kova yok";
  const prunedText = summarize(pruned);

  return {
    rolled,
    pruned,
    detail: prunedText ? `toplandı ${rolledText} · budandı ${prunedText}` : `toplandı ${rolledText}`,
  };
}
