"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * M2.7 — kiosk ekranını periyodik tazeler.
 *
 * `router.refresh()` kullanılıyor, `location.reload()` değil: tam yeniden
 * yükleme duvardaki ekranda gözle görülür bir beyaz parlama yapar ve saat
 * her seferinde sıfırdan çizilir. Router yenilemesi yalnızca sunucu
 * bileşenlerini tazeler, sayfa yerinde kalır.
 */
export function KioskRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), Math.max(10, seconds) * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);

  return null;
}
