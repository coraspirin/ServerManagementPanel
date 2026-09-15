import "server-only";

import { runCheck, type CheckResult } from "./check";
import { effectiveSettings, getMonitor, listMonitors, recordCheck } from "./store";
import type { Monitor, MonitorStatus } from "./types";

/** Health-check turunu yürüten katman (M1.2). */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type MonitorOutcome = {
  monitor: Monitor;
  result: CheckResult;
  status: MonitorStatus;
  changed: boolean;
  inMaintenance: boolean;
  attempts: number;
};

/**
 * Tek monitörü kontrol eder.
 *
 * `retries` AYNI TUR içinde tekrar denemedir: anlık bir paket kaybı ya da
 * yeniden başlayan bir container yüzünden servis düşmüş sayılmasın. Ardışık
 * turlardaki hata sayısı ise `down_threshold` ile ayrı değerlendirilir —
 * ikisi farklı şeyler.
 */
export async function checkMonitor(monitor: Monitor): Promise<MonitorOutcome> {
  const effective = effectiveSettings(monitor);

  let result: CheckResult = { ok: false, latencyMs: 0, error: "kontrol çalışmadı" };
  let attempts = 0;

  for (let attempt = 0; attempt <= effective.retries; attempt++) {
    attempts = attempt + 1;
    result = await runCheck(monitor, effective.timeoutSeconds);
    if (result.ok) break;
    if (attempt < effective.retries) await sleep(500);
  }

  const outcome = recordCheck(monitor, result);
  return { monitor, result, attempts, ...outcome };
}

/** Zamanı gelmiş tüm monitörleri kontrol eder — job runner buradan geçer. */
export async function checkDueMonitors(): Promise<{
  checked: number;
  changes: MonitorOutcome[];
}> {
  const now = Math.floor(Date.now() / 1000);
  const due = listMonitors().filter(
    (monitor) =>
      monitor.enabled && (monitor.nextCheckAt === null || monitor.nextCheckAt <= now),
  );

  if (due.length === 0) return { checked: 0, changes: [] };

  const outcomes = await Promise.all(due.map((monitor) => checkMonitor(monitor)));
  return { checked: outcomes.length, changes: outcomes.filter((o) => o.changed) };
}

export async function runMonitorNow(id: number): Promise<MonitorOutcome | null> {
  const monitor = getMonitor(id);
  return monitor ? checkMonitor(monitor) : null;
}
