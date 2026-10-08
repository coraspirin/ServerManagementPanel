"use client";

import { useEffect, useState } from "react";

import { CSRF_HEADER } from "@/lib/auth/types";
import type { LiveProgress } from "@/lib/backup/types";
import { withHostQuery } from "@/lib/client/host";
import { readCsrfToken } from "@/components/docker/detail/shared";

/** Yedekleme ekranının istemci yardımcıları. */

export class ApiError extends Error {}

export async function api<T = unknown>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(method === "GET" ? {} : { [CSRF_HEADER]: readCsrfToken() }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message = (data as { error?: string } | null)?.error ?? `HTTP ${response.status}`;
    throw new ApiError(message);
  }
  return data as T;
}

/** Dosya yanıtı (kurtarma kiti) — tarayıcıya indirtir. */
export async function downloadPost(url: string, body: unknown, fallbackName: string): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(data?.error ?? `HTTP ${response.status}`);
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  const blob = await response.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[index]}`;
}

/**
 * Canlı koşular (SSE). Bağlantı koparsa tarayıcı EventSource'u kendisi
 * yeniden bağlar; bir koşu bitince `onFinish` bir kez çağrılır (ekran tazelensin).
 */
export function useLiveRuns(onFinish?: (run: LiveProgress) => void): LiveProgress[] {
  const [runs, setRuns] = useState<LiveProgress[]>([]);

  useEffect(() => {
    const source = new EventSource(withHostQuery("/api/backup/live"));
    const finished = new Set<number>();
    source.addEventListener("runs", (event) => {
      try {
        const next = JSON.parse((event as MessageEvent<string>).data) as LiveProgress[];
        setRuns(next);
        for (const run of next) {
          if (run.done && !finished.has(run.runId)) {
            finished.add(run.runId);
            onFinish?.(run);
          }
        }
      } catch {
        // Bozuk mesaj: sıradakini bekle.
      }
    });
    return () => source.close();
    // onFinish bilinçli olarak bağımlılık değil: her render'da yeni bağlantı açılmasın.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return runs;
}

export const buttonClass =
  "inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand disabled:opacity-50";
export const smallButtonClass =
  "inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-xs transition-colors hover:border-brand disabled:opacity-50";
export const primaryButtonClass =
  "inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50";
export const inputClass =
  "w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand disabled:opacity-50";
export const cardClass = "rounded-lg border border-line bg-surface";
