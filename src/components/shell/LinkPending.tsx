"use client";

import { Loader2 } from "lucide-react";
import { useLinkStatus } from "next/link";

/**
 * Bir `<Link>`in bekleyen durumunu gösteren küçük dönen simge (M3.45).
 *
 * ## Neden gerekiyor
 *
 * Panelin her sayfası `dynamic = "force-dynamic"`: hiçbiri önceden
 * üretilemiyor, her geçiş sunucudan yanıt bekliyor. Bu bekleme sırasında
 * ekranda HİÇBİR ŞEY değişmiyordu — kullanıcı tıkladığından emin olamayıp
 * ikinci kez tıklıyordu.
 *
 * Asıl çözüm rota seviyesindeki `loading.tsx` (bkz. app/(panel)/loading.tsx);
 * bu bileşen onun tamamlayıcısı: iskelet ekrana gelene kadar geçen, ağ
 * yavaşsa fark edilir olan aralığı dolduruyor. Next'in kendi belgeleri de
 * ikisini birlikte öneriyor.
 *
 * ## Neden hep çiziliyor
 *
 * Simge yalnızca `pending` iken EKLENSEYDİ menü maddesi her tıklamada bir
 * miktar genişler, satırlar oynardı. Bunun yerine yer her zaman ayrılıyor ve
 * sadece saydamlık değişiyor — Next belgelerindeki uyarının doğrudan karşılığı.
 *
 * `useLinkStatus` yalnızca bir `<Link>`in ALTINDA çalışır; başka yerde her
 * zaman `{ pending: false }` döner.
 */
export function LinkPending({ className = "" }: { className?: string }) {
  const { pending } = useLinkStatus();

  return (
    <Loader2
      aria-hidden
      className={`size-3.5 shrink-0 animate-spin transition-opacity duration-150 ${
        pending ? "opacity-100" : "opacity-0"
      } ${className}`}
    />
  );
}
