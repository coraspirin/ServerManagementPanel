import { loadFixture } from "@/lib/fixtures";
import type { MetricSample, MetricsProvider } from "./types";

/**
 * MOCK_MODE metrik üreteci (T10).
 *
 * ÖNEMLİ TASARIM KARARI: üretilen değer YALNIZCA zaman damgasının fonksiyonudur
 * — rastgele durum tutulmaz. Bunun iki faydası var:
 *   1. Geçmiş veri üretilebilir (`sampleAt` ile geriye dönük doldurma), böylece
 *      Windows'ta 30 günlük/1 yıllık grafik ve katman seçimi günlerce veri
 *      birikmesini beklemeden sınanabilir.
 *   2. Aynı zaman damgası her zaman aynı değeri verir; ekran titremez.
 *
 * Sinyal günlük + haftalık çevrim ve tekrarlanabilir gürültünün toplamıdır:
 * gerçekçi görünür ama tamamen uydurmadır.
 */

export type MetricsFixture = {
  cpu: { basePct: number; swingPct: number; iowaitBasePct: number };
  memory: { totalBytes: number; baseUsedPct: number; swingPct: number };
  swap: { totalBytes: number; baseUsedPct: number; swingPct: number };
  load: { base: number; swing: number };
  disks: {
    mount: string;
    totalBytes: number;
    baseUsedPct: number;
    growthPctPerMonth: number;
  }[];
  interfaces: { name: string; baseRxBps: number; baseTxBps: number; swing: number }[];
};

let cached: MetricsFixture | null = null;

/** Fixture bir kez okunur; geçmiş doldurma binlerce kez çağırıyor. */
export async function mockFixture(): Promise<MetricsFixture> {
  cached ??= await loadFixture<MetricsFixture>("metrics");
  return cached;
}

/** Tekrarlanabilir 0..1 gürültü — aynı (seed, ts) her zaman aynı sayıyı verir. */
function noise(seed: string, ts: number): number {
  let hash = 2166136261;
  const input = `${seed}:${ts}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000;
}

/** Günlük + haftalık çevrim: gece sakin, iş saatlerinde yoğun. */
function cycle(ts: number): number {
  const daily = Math.sin(((ts % 86400) / 86400) * Math.PI * 2 - Math.PI / 2);
  const weekly = Math.sin(((ts % 604800) / 604800) * Math.PI * 2);
  return daily * 0.75 + weekly * 0.25;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number(value.toFixed(2))));
}

/** Verilen ana ait tam örnek kümesi. Geçmiş doldurma da bunu kullanır. */
export function sampleAt(fx: MetricsFixture, ts: number): MetricSample[] {
  const wave = cycle(ts);
  const samples: MetricSample[] = [];

  const cpu = fx.cpu.basePct + wave * fx.cpu.swingPct + noise("cpu", ts) * 12;
  samples.push({ metric: "cpu.pct", value: clamp(cpu, 0.5, 100) });
  samples.push({
    metric: "cpu.iowait_pct",
    value: clamp(fx.cpu.iowaitBasePct + noise("io", ts) * 2.5, 0, 100),
  });

  const memPct = clamp(
    fx.memory.baseUsedPct + wave * fx.memory.swingPct + noise("mem", ts) * 3,
    5,
    99,
  );
  samples.push(
    { metric: "mem.total", value: fx.memory.totalBytes },
    { metric: "mem.used", value: Math.round((fx.memory.totalBytes * memPct) / 100) },
    { metric: "mem.used_pct", value: memPct },
  );

  const swapPct = clamp(fx.swap.baseUsedPct + noise("swap", ts) * fx.swap.swingPct, 0, 100);
  samples.push(
    { metric: "swap.used", value: Math.round((fx.swap.totalBytes * swapPct) / 100) },
    { metric: "swap.used_pct", value: swapPct },
  );

  const load1 = clamp(fx.load.base + wave * fx.load.swing + noise("load", ts) * 0.4, 0, 64);
  samples.push(
    { metric: "load.1m", value: load1 },
    { metric: "load.5m", value: clamp(load1 * 0.9 + 0.05, 0, 64) },
    { metric: "load.15m", value: clamp(load1 * 0.8 + 0.08, 0, 64) },
  );

  // Sabit bir açılış anına göre artan uptime — panelde makul görünsün.
  samples.push({ metric: "uptime.seconds", value: Math.max(0, ts - 1_749_000_000) });

  for (const disk of fx.disks) {
    // Diskler yavaşça dolar; kapasite tahmini (M1.5) için anlamlı bir eğim.
    const months = (ts - 1_749_000_000) / (30 * 86400);
    const pct = clamp(
      disk.baseUsedPct + months * disk.growthPctPerMonth + noise(disk.mount, ts) * 0.3,
      1,
      99.5,
    );
    const used = Math.round((disk.totalBytes * pct) / 100);
    samples.push(
      { metric: "disk.total", label: disk.mount, value: disk.totalBytes },
      { metric: "disk.used", label: disk.mount, value: used },
      { metric: "disk.free", label: disk.mount, value: disk.totalBytes - used },
      { metric: "disk.used_pct", label: disk.mount, value: pct },
    );
  }

  for (const iface of fx.interfaces) {
    const factor = 1 + wave * iface.swing + (noise(`${iface.name}rx`, ts) - 0.5) * 1.2;
    const txFactor = 1 + wave * iface.swing + (noise(`${iface.name}tx`, ts) - 0.5) * 1.2;
    samples.push(
      {
        metric: "net.rx_bps",
        label: iface.name,
        value: Math.max(0, Math.round(iface.baseRxBps * factor)),
      },
      {
        metric: "net.tx_bps",
        label: iface.name,
        value: Math.max(0, Math.round(iface.baseTxBps * txFactor)),
      },
    );
  }

  return samples;
}

export async function mockSampleAt(ts: number): Promise<MetricSample[]> {
  return sampleAt(await mockFixture(), ts);
}

export const mockMetricsProvider: MetricsProvider = {
  async sample(): Promise<MetricSample[]> {
    return mockSampleAt(Math.floor(Date.now() / 1000));
  },
};
