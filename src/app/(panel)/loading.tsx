import { getT } from "@/lib/i18n/server";

/**
 * Panel sayfaları arası geçiş iskeleti (M3.45).
 *
 * ## Neden grup seviyesinde tek dosya
 *
 * Panelin bütün sayfaları `dynamic = "force-dynamic"` — hiçbiri önceden
 * üretilmiyor, her geçiş sunucu yanıtı bekliyor. `loading.tsx` olmadan Next
 * geçişi yanıt gelene kadar BAŞLATMIYOR: kullanıcı tıklıyor, ekran eski
 * sayfada donuyor ve tıkladığını anlamıyordu.
 *
 * Dosya `(panel)` grubunun kökünde: her sayfaya ayrı iskelet yazmak, on beş
 * ekranın düzenini iki yerde tutmak olurdu ve ikisi kaçınılmaz olarak
 * ayrışırdı. Buradaki genel iskelet "bir şey yükleniyor" sorusunu yanıtlıyor;
 * sayfaya özgü olması gerekmiyor.
 *
 * Kenar çubuğu ve üstbar `layout.tsx`te olduğu için yerinde kalıyor ve
 * TIKLANABİLİR olmayı sürdürüyor — geçiş yarıda kesilebiliyor.
 */
export default function PanelLoading() {
  const t = getT();
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">{t("panelLoading")}</span>

      {/* Ölçüler panelin tipik ekranından: başlık şeridi, araç çubuğu ve
          bir liste. Kesin olması gerekmiyor, YERİ tutması gerekiyor —
          içerik gelince sayfanın zıplamaması için. */}
      <div className="h-9 w-64 animate-pulse rounded-md bg-line/60" />

      <div className="flex flex-wrap gap-2">
        <div className="h-8 w-48 animate-pulse rounded-md bg-line/60" />
        <div className="h-8 w-24 animate-pulse rounded-md bg-line/40" />
        <div className="h-8 w-24 animate-pulse rounded-md bg-line/40" />
      </div>

      <div className="divide-y divide-line rounded-lg border border-line bg-surface">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div key={row} className="flex items-center gap-3 px-4 py-3">
            <div className="size-4 animate-pulse rounded bg-line/60" />
            <div className="h-4 flex-1 animate-pulse rounded bg-line/50" />
            <div className="hidden h-4 w-24 animate-pulse rounded bg-line/40 sm:block" />
            <div className="hidden h-4 w-16 animate-pulse rounded bg-line/40 sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
