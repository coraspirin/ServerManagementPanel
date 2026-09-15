import type { Series } from "./catalog.ts";

/**
 * Kümülatif sayaç serisini HIZ serisine çevirir (M3.22).
 *
 * Docker'ın container istatistiklerinde ağ ve disk sayaçları "container
 * başlangıcından beri toplam bayt" olarak geliyor. Bunu doğrudan çizmek,
 * yalnızca yukarı giden ve şeklinden hiçbir şey anlaşılmayan bir çizgi
 * üretir; kullanıcının merak ettiği "şu an ne kadar trafik var" sorusu iki
 * örnek arasındaki farkla cevaplanıyor.
 *
 * ⚠️ SAYAÇ SIFIRLANMASI. Container yeniden başladığında sayaç sıfırdan sayar
 * ve fark NEGATİF çıkar. Negatif bir "saniyede bayt" değeri anlamsız ve
 * grafiği aşağı kırar — bu yüzden düşüş görülen aralık, hız hesabından
 * tamamen ÇIKARILIYOR (sıfır yazmak, o anda gerçekten trafik olmadığı
 * yalanını söylerdi).
 *
 * I/O yok: `@/` yolu `node --test` altında çözülmediği için saf tutuluyor.
 */
export function counterToRate(series: Series): Series {
  const points = series.points;
  const out: Series["points"] = [];

  for (let index = 1; index < points.length; index += 1) {
    const onceki = points[index - 1];
    const simdi = points[index];

    const gecen = simdi.ts - onceki.ts;
    if (gecen <= 0) continue;

    const fark = simdi.avg - onceki.avg;
    // Sayaç sıfırlandı (container yeniden başladı): bu aralığı atla.
    if (fark < 0) continue;

    const hiz = fark / gecen;
    out.push({ ts: simdi.ts, avg: hiz, min: hiz, max: hiz });
  }

  return { metric: series.metric, label: series.label, points: out };
}

/** Birden çok seriyi tek seferde çevirir. */
export function countersToRates(series: Series[]): Series[] {
  return series.map(counterToRate);
}
