"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Layers } from "lucide-react";

import { formatBytes } from "@/lib/metrics/catalog";
import { buildLayerView, layerTotals } from "@/lib/docker/layers";
import type { ImageLayer } from "@/lib/providers/types";

/**
 * Katman yığını görünümü (M3.43).
 *
 * Öncesinde katmanlar büyükten küçüğe sıralı bir metin listesiydi ve her satır
 * Docker'ın ham `CreatedBy` çıktısını basıyordu. İki sorun vardı:
 *
 * 1. **Sıralama yığını bozuyordu.** Katmanlar bir yığın; hangisinin hangisinin
 *    üstüne bindiğini görmek, imajın nasıl kurulduğunu okumak demek. Boyuta
 *    göre sıralamak bu bilgiyi tamamen siliyordu.
 * 2. **Ölçek görünmüyordu.** "169.98 MB" ile "20 KB" yan yana iki metin;
 *    aradaki 8000 katlık farkı gözle yakalamak mümkün değil.
 *
 * Çubuk uzunluğu farkı doğrudan gösteriyor ve asıl soruya — *"bu imaj neden bu
 * kadar yer kaplıyor?"* — bakışta cevap veriyor.
 *
 * Ham komut atılmadı, **katlandı**: satıra tıklamak tam metni açıyor.
 */

/**
 * Katman renkleri.
 *
 * Her satırın ayrı bir rengi olması dekoratif değil: yığın uzun (20+ katman
 * sık) ve renk, göz kaydırırken satırın kendisiyle etiketini bir arada
 * tutuyor. Sabit bir palet kullanılıyor ve indeksle dönüyor — rastgele renk,
 * aynı imajı iki kez açtığında farklı görünmek demekti.
 *
 * Değerler doğrudan yazılı çünkü bu renkler panelin anlam paleti değil
 * (`danger`, `ok`, `warn` bir DURUM anlatıyor; burada durum yok, ayırt etme
 * var). Hepsi beyaz yazıyı taşıyacak koyulukta ve iki temada da aynı.
 */
const RENKLER = [
  "#ec4899",
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#84cc16",
  "#22c55e",
  "#10b981",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#d946ef",
];

export function ImageLayers({ layers }: { layers: ImageLayer[] }) {
  const [acik, setAcik] = useState<ReadonlySet<number>>(() => new Set());

  const view = buildLayerView(layers);
  const totals = layerTotals(layers);

  const toggle = (index: number) =>
    setAcik((prev) => {
      const next = new Set(prev);
      if (!next.delete(index)) next.add(index);
      return next;
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-line bg-canvas px-4 py-3 text-sm">
        <span>
          <span className="text-subtle">Toplam katman: </span>
          <span className="font-medium text-brand">{totals.count}</span>
        </span>
        <span>
          <span className="text-subtle">Toplam boyut: </span>
          <span className="font-medium text-brand">{formatBytes(totals.sizeBytes)}</span>
        </span>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-subtle">
        <Layers className="size-3.5" aria-hidden />
        Katman yığını (üstteki en yeni) — satıra tıkla, tam komut açılsın
      </p>

      <ul className="space-y-1">
        {view.map((layer) => {
          const genis = acik.has(layer.index);
          const renk = RENKLER[(layer.index - 1) % RENKLER.length];
          const etiket = `${layer.sizeBytes > 0 ? formatBytes(layer.sizeBytes) : "0 B"}  ${layer.instruction}`;

          return (
            <li key={`${layer.id}-${layer.index}`}>
              <button
                type="button"
                onClick={() => toggle(layer.index)}
                aria-expanded={genis}
                className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-line/40"
              >
                {genis ? (
                  <ChevronDown className="size-3.5 shrink-0 text-subtle" aria-hidden />
                ) : (
                  <ChevronRight className="size-3.5 shrink-0 text-subtle" aria-hidden />
                )}

                <span className="w-8 shrink-0 text-right font-mono text-[11px] text-subtle">
                  #{layer.index}
                </span>

                {/*
                  Çubuk kanalı: boş kısmı da çizili, yoksa kısa çubukların
                  neye göre kısa olduğu belli olmazdı.
                */}
                <span className="relative h-6 min-w-0 flex-1 overflow-hidden rounded bg-line/40">
                  <span
                    className="absolute inset-y-0 left-0 flex items-center rounded px-2 text-[10px] font-semibold whitespace-nowrap text-white"
                    style={{
                      // `max` ile taban: sıfır baytlık katmanın etiketi de
                      // okunabilsin. Etiket çubuktan uzunsa taşıyor ve
                      // `overflow-hidden` onu kanalın içinde tutuyor.
                      width: `max(${layer.widthPct.toFixed(2)}%, 7.5rem)`,
                      backgroundColor: renk,
                    }}
                  >
                    {etiket}
                  </span>
                </span>

                <span className="w-20 shrink-0 text-right font-mono text-[11px]">
                  {layer.sizeBytes > 0 ? formatBytes(layer.sizeBytes) : "0 B"}
                </span>

                <span
                  className={`w-16 shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-medium ${
                    layer.large ? "bg-warn/15 text-warn" : "bg-line text-subtle"
                  }`}
                  title={
                    layer.large
                      ? `İmajın %${layer.sharePct.toFixed(0)}'i bu katmanda`
                      : `İmajın %${layer.sharePct.toFixed(1)}'i`
                  }
                >
                  {layer.large ? "Büyük" : "Normal"}
                </span>
              </button>

              {genis && (
                <div className="ml-12 mr-2 mb-1 rounded-md border border-line bg-canvas px-3 py-2">
                  <code className="block break-all font-mono text-[11px] leading-relaxed">
                    {layer.instruction !== "—" && (
                      <span className="mr-1.5 font-semibold" style={{ color: renk }}>
                        {layer.instruction}
                      </span>
                    )}
                    {layer.argument || <span className="text-subtle">(argüman yok)</span>}
                  </code>

                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-subtle">
                    <span>İmajın %{layer.sharePct.toFixed(1)}&apos;i</span>
                    {layer.createdAt > 0 && (
                      <span>{new Date(layer.createdAt * 1000).toLocaleString("tr-TR")}</span>
                    )}
                    {/*
                      Ara katmanların çoğunda kimlik `<missing>` gelir: Docker
                      uzaktan çekilen imajlarda onları saklamıyor. Boş bir
                      satır basmak yerine hiç göstermiyoruz.
                    */}
                    {layer.id && layer.id !== "<missing>" && (
                      <span className="font-mono">{layer.id.replace(/^sha256:/, "").slice(0, 12)}</span>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p className="text-[11px] text-subtle">
        Çubuk uzunlukları en büyük katmana göre. Bir imajın neden bu kadar yer
        kapladığını burada görürsün — genellikle tek bir <span className="font-mono">RUN</span>{" "}
        katmanı sorumludur ve onu bölmek ya da aynı katmanda temizlik yapmak imajı
        küçültür.
      </p>
    </div>
  );
}
