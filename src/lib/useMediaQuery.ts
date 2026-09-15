"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Bir medya sorgusunun anlık sonucu.
 *
 * `useState` + `useEffect` yerine `useSyncExternalStore` kullanılıyor: sunucuda
 * her zaman `false` dönüyor ve ilk boyamada tarayıcının gerçek değeriyle
 * eşitleniyor, böylece hidrasyon uyuşmazlığı çıkmıyor.
 *
 * Dikkat: yalnızca düzenin *davranışı* JS'e bağlıysa kullanın (odak tuzağı,
 * `inert`, bileşen seçimi gibi). Sadece görünüm değişecekse Tailwind'in
 * `sm:`/`lg:` ön ekleri her zaman daha doğru — onlar ilk boyamada da doğrudur.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Tailwind `lg` eşiği (64rem) — kenar çubuğunun sabit sütuna döndüğü nokta. */
export const DESKTOP_QUERY = "(min-width: 64rem)";

/** Tailwind `md` eşiği (48rem) — geniş tabloların karta dönüştüğü nokta. */
export const TABLET_QUERY = "(min-width: 48rem)";
