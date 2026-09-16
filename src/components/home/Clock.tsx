"use client";

import { useSyncExternalStore } from "react";
import { useFormat } from "@/lib/i18n/client";

/**
 * M2.7 — saat.
 *
 * `useEffect` + `setState` yerine `useSyncExternalStore`: saat React'in değil
 * dış dünyanın durumu ve efekt içinde setState çağırmak cascading render
 * üretiyor (react-hooks/set-state-in-effect).
 *
 * Sunucu anlık görüntüsü `null`: sunucunun saati ile tarayıcınınki farklı
 * olabilir ve fark hidrasyon uyuşmazlığı verir. İlk çizim boş, hemen ardından
 * gerçek saat geliyor.
 */

function subscribe(onChange: () => void): () => void {
  // Dakika başına değil saniyede bir: dakika sınırında geç güncellenen bir
  // saat, duvara asılı ekranda hemen göze çarpıyor.
  const timer = setInterval(onChange, 1000);
  return () => clearInterval(timer);
}

/** Saniye çözünürlüğü ŞART: her çağrıda yeni bir değer dönerse React döngüye girer. */
function snapshot(): number {
  return Math.floor(Date.now() / 1000);
}

export function Clock({ big = false }: { big?: boolean }) {
  const f = useFormat();
  const seconds = useSyncExternalStore(subscribe, snapshot, () => null);
  const now = seconds === null ? null : new Date(seconds * 1000);

  return (
    <div>
      <div
        className={`font-semibold tabular-nums ${big ? "text-6xl" : "text-3xl"}`}
        // Boşken de aynı yüksekliği kaplasın; yoksa saat gelince sayfa zıplıyor.
        style={{ minHeight: "1em" }}
      >
        {now ? f.time(now) : " "}
      </div>
      <div className={`text-subtle ${big ? "mt-1 text-lg" : "text-xs"}`}>
        {now
          ? f.date(now, { weekday: "long", day: "numeric", month: "long" })
          : " "}
      </div>
    </div>
  );
}
