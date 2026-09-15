"use client";

import { CSRF_COOKIE } from "@/lib/auth/types";

/**
 * Detay sekmelerinin ortak parçaları (M3.20).
 *
 * Sekmelere ayrılmadan önce bunlar 631 satırlık tek bir `ContainerDetail`
 * dosyasının dibinde duruyordu. Bölünme sırasında kopyalanmaları, aynı görünen
 * ama zamanla ayrışan beş `Section` demek olurdu.
 */

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line bg-surface px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="w-28 shrink-0 text-xs text-subtle">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

export function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

/** Bayt sayısını okunur hâle getirir; sekmelerin çoğunda gerekiyor. */
export function bytes(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 100 ? 0 : 1)} ${units[unit]}`;
}
