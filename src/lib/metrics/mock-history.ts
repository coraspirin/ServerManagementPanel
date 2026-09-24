import "server-only";

import { getDb } from "@/lib/db/client";
import { isMockMode } from "@/lib/env";
import { mockHistoryHostIds, scaleSample } from "@/lib/hosts/mock";
import { mockFixture, sampleAt } from "@/lib/providers/metrics.mock";
import { getNumber } from "@/lib/settings";

/**
 * MOCK_MODE geçmiş doldurma (T10) — YALNIZCA geliştirme kolaylığı için.
 *
 * Neden var: 30 günlük ve 1 yıllık grafikler ile katman seçimi (T1), gerçek
 * veriyle sınanmak için haftalarca veri birikmesini bekler. Sahte üreteç zamanın
 * saf bir fonksiyonu olduğu için geçmişi de üretebiliyor; böylece Windows'ta
 * `MOCK_MODE=1` ile açılan panelde tüm zaman aralıkları ilk saniyeden itibaren
 * doludur.
 *
 * Canlı kurulumda ASLA çalışmaz: MOCK_MODE kapalıysa ve tabloda veri varsa
 * hemen döner.
 */

const TIERS = [
  // tablo,        kova,  kaç geriye,      kova başına alt örnek
  { table: "metrics_1m", bucket: 60, span: 26 * 3600, subSamples: 6 },
  { table: "metrics_1h", bucket: 3600, span: 32 * 86400, subSamples: 8 },
  { table: "metrics_1d", bucket: 86400, span: 400 * 86400, subSamples: 12 },
] as const;

export async function seedMockHistory(): Promise<string | null> {
  if (!isMockMode()) return null;

  const db = getDb();
  // Çoklu sunucu: geçmişi olmayan her (yerel ya da sahte) sunucu için ayrı
  // üretilir — MOCK_HOSTS sonradan artırılırsa yeni sunucular da dolar.
  const hasHistory = db.prepare("SELECT 1 FROM metrics_1d WHERE host_id = ? LIMIT 1");
  const pending = mockHistoryHostIds().filter((id) => !hasHistory.get(id));
  if (pending.length === 0) return null;

  const fx = await mockFixture();
  const now = Math.floor(Date.now() / 1000);
  const collect = Math.max(5, getNumber("monitoring.collect_interval"));

  const insertRaw = db.prepare(
    `INSERT OR REPLACE INTO metrics_raw (host_id, metric, label, ts, value) VALUES (?, ?, ?, ?, ?)`,
  );
  const insertTier = new Map(
    TIERS.map((tier) => [
      tier.table,
      db.prepare(
        `INSERT OR REPLACE INTO ${tier.table}
           (host_id, metric, label, ts, avg_value, min_value, max_value, sample_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
    ]),
  );

  let rows = 0;

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const hostId of pending) {
      // Ham katman: son ~70 dakika. 1 saatlik grafik bunu kullanır.
      for (let ts = now - 70 * 60; ts <= now; ts += collect) {
        const aligned = Math.floor(ts / collect) * collect;
        for (const sample of sampleAt(fx, aligned).map((raw) => scaleSample(raw, hostId))) {
          insertRaw.run(hostId, sample.metric, sample.label ?? "", aligned, sample.value);
          rows++;
        }
      }

      // Toplanmış katmanlar: kova içinden birkaç alt örnek alınıp ortalama/min/max
      // hesaplanır — düz bir çizgi yerine gerçek veriye benzeyen bir bant çıksın.
      for (const tier of TIERS) {
        const statement = insertTier.get(tier.table)!;
        const step = Math.floor(tier.bucket / tier.subSamples);
        const start = Math.floor((now - tier.span) / tier.bucket) * tier.bucket;
        const end = Math.floor(now / tier.bucket) * tier.bucket;

        for (let bucket = start; bucket < end; bucket += tier.bucket) {
          const accumulated = new Map<string, { sum: number; min: number; max: number }>();
          const meta = new Map<string, { metric: string; label: string }>();

          for (let i = 0; i < tier.subSamples; i++) {
            for (const sample of sampleAt(fx, bucket + i * step).map((raw) => scaleSample(raw, hostId))) {
              const key = `${sample.metric} ${sample.label ?? ""}`;
              const entry = accumulated.get(key);
              if (entry) {
                entry.sum += sample.value;
                entry.min = Math.min(entry.min, sample.value);
                entry.max = Math.max(entry.max, sample.value);
              } else {
                accumulated.set(key, {
                  sum: sample.value,
                  min: sample.value,
                  max: sample.value,
                });
                meta.set(key, { metric: sample.metric, label: sample.label ?? "" });
              }
            }
          }

          for (const [key, entry] of accumulated) {
            const { metric, label } = meta.get(key)!;
            statement.run(
              hostId,
              metric,
              label,
              bucket,
              entry.sum / tier.subSamples,
              entry.min,
              entry.max,
              tier.bucket / collect,
            );
            rows++;
          }
        }
      }
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return `${rows} sahte metrik satırı üretildi (yalnızca MOCK_MODE)`; // i18n-ignore — operatör logu
}
