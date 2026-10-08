import "server-only";

import type { LiveProgress } from "./types";

/**
 * Çalışan koşuların bellek içi kaydı: canlı ilerleme, iptal ve SSE aboneleri.
 *
 * `globalThis` üzerinde: Next.js aynı süreçte rota modüllerini ayrı
 * yükleyebiliyor; kayıt tek olmalı ki "Yedekle" isteğinin başlattığı koşuyu
 * SSE isteği görebilsin. Bitmiş koşular bir süre daha tutulur — ekran son
 * durumu (başarılı/hata) gösterebilsin.
 */

type Entry = {
  hostId: number;
  progress: LiveProgress;
  abort: AbortController;
  listeners: Set<(progress: LiveProgress) => void>;
};

const KEEP_FINISHED_MS = 60_000;

const registry: Map<number, Entry> = ((globalThis as Record<string, unknown>).__panelBackupLive ??= new Map()) as Map<
  number,
  Entry
>;

export function registerRun(hostId: number, progress: LiveProgress): AbortSignal {
  const entry: Entry = { hostId, progress, abort: new AbortController(), listeners: new Set() };
  registry.set(progress.runId, entry);
  return entry.abort.signal;
}

export function updateRun(runId: number, patch: Partial<LiveProgress>): void {
  const entry = registry.get(runId);
  if (!entry) return;
  entry.progress = { ...entry.progress, ...patch };
  for (const listener of entry.listeners) {
    try {
      listener(entry.progress);
    } catch {
      // Kopmuş bir abone diğerlerini etkilememeli.
    }
  }
}

export function finishLiveRun(runId: number, patch: Partial<LiveProgress>): void {
  updateRun(runId, { ...patch, done: true });
  setTimeout(() => {
    const entry = registry.get(runId);
    if (entry?.progress.done) registry.delete(runId);
  }, KEEP_FINISHED_MS).unref?.();
}

export function cancelRun(runId: number, hostId: number): boolean {
  const entry = registry.get(runId);
  if (!entry || entry.hostId !== hostId || entry.progress.done) return false;
  entry.abort.abort();
  return true;
}

export function liveRuns(hostId: number): LiveProgress[] {
  return [...registry.values()].filter((entry) => entry.hostId === hostId).map((entry) => entry.progress);
}

export function liveRun(runId: number, hostId: number): LiveProgress | null {
  const entry = registry.get(runId);
  return entry && entry.hostId === hostId ? entry.progress : null;
}

/** Sürmekte olan (bitmemiş) koşu kimlikleri — tüm sunucular. */
export function activeRunIds(): Set<number> {
  return new Set([...registry.values()].filter((entry) => !entry.progress.done).map((entry) => entry.progress.runId));
}

export function isJobActive(jobId: number): boolean {
  return [...registry.values()].some((entry) => entry.progress.jobId === jobId && !entry.progress.done);
}

export function subscribe(runId: number, listener: (progress: LiveProgress) => void): () => void {
  const entry = registry.get(runId);
  if (!entry) return () => undefined;
  entry.listeners.add(listener);
  return () => entry.listeners.delete(listener);
}
