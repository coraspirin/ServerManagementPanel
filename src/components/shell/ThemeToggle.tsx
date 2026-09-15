"use client";

import { Moon, Sun } from "lucide-react";

/**
 * Aydınlık/karanlık tema düğmesi (M3.46).
 *
 * ## Neden tarayıcıda saklanıyor
 *
 * Tema bir GÖRÜNÜM tercihi ve cihaza bağlı: aynı kullanıcı masaüstünde koyu,
 * telefonda açık isteyebiliyor. Sunucudaki `general.theme` ayarı kurulumun
 * varsayılanını söylüyor; buradaki düğme o cihazın kararı ve `localStorage`'a
 * yazılıyor.
 *
 * ## Neden React durumu YOK
 *
 * Düğmenin göstereceği simge tek bir şeye bağlı: `<html>` üzerinde `.dark`
 * sınıfı var mı. Bunu bir state'e kopyalamak iki sorun getiriyordu — sunucu
 * hangi temanın seçili olduğunu bilemediği için ilk render'da uyuşmazlık, ve
 * sınıfı başka bir yerden (açılış betiği) değiştiren her kod için ayrı bir
 * eşitleme. Simgeler `dark:` varyantıyla CSS'te seçiliyor; kaynak tek ve
 * doğru olan yer sınıfın kendisi.
 *
 * ## Neden üç durumlu değil
 *
 * "Sistem / açık / koyu" üçlüsü ayarlar ekranının işi. Üstbardaki düğmenin
 * tek bir sorusu var: şu an gördüğün temanın tersine geç. Üç durumu bir
 * düğmeye sığdırmak, kullanıcının bir sonraki tıklamanın ne yapacağını
 * bilememesi demekti.
 */

/** `layout.tsx`teki açılış betiği ile AYNI anahtar. */
const STORAGE_KEY = "panel-theme";

export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const next = !root.classList.contains("dark");
    root.classList.toggle("dark", next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
    } catch {
      // Gizli sekmede depolama kapalı olabilir; tema yine de bu oturumda değişir.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title="Aydınlık ve karanlık tema arasında geçiş yap"
      aria-label="Temayı değiştir"
      className="flex shrink-0 items-center justify-center rounded-md border border-line p-1.5 text-subtle transition-colors hover:text-ink"
    >
      {/*
        İki simge de çiziliyor, biri gizli: hangisinin görüneceğine `.dark`
        sınıfı karar veriyor. Simge, tıklanınca VARILACAK temayı gösteriyor —
        koyu temadayken güneş, açık temadayken ay.
      */}
      <Moon className="size-4 dark:hidden" aria-hidden />
      <Sun className="hidden size-4 dark:block" aria-hidden />
    </button>
  );
}
