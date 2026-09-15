/**
 * Kümülatif sayaç → hız çevriminin sözleşme testleri (M3.22).
 *
 * En kritik iddia SAYAÇ SIFIRLANINCA NEGATİF HIZ ÜRETMEZ: container yeniden
 * başladığında Docker'ın sayacı sıfırdan sayar ve naif bir fark hesabı
 * grafiği eksiye kırar.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { Series } from "./catalog.ts";
import { counterToRate, countersToRates } from "./rates.ts";

function seri(values: [number, number][]): Series {
  return {
    metric: "docker.net_rx",
    label: "panel",
    points: values.map(([ts, value]) => ({ ts, avg: value, min: value, max: value })),
  };
}

describe("counterToRate", () => {
  it("iki örnek arasındaki farkı saniyeye böler", () => {
    const sonuc = counterToRate(seri([[100, 0], [110, 1000]]));
    assert.equal(sonuc.points.length, 1);
    assert.equal(sonuc.points[0].ts, 110);
    assert.equal(sonuc.points[0].avg, 100);
  });

  it("ilk örnek için nokta ÜRETMEZ — öncesi bilinmiyor", () => {
    const sonuc = counterToRate(seri([[100, 500]]));
    assert.equal(sonuc.points.length, 0);
  });

  it("SAYAÇ SIFIRLANINCA negatif hız üretmez, o aralığı atlar", () => {
    // 100→110: normal artış. 110→120: container yeniden başladı, sayaç sıfırlandı.
    // 120→130: yeniden artış.
    const sonuc = counterToRate(
      seri([
        [100, 5_000],
        [110, 6_000],
        [120, 200],
        [130, 900],
      ]),
    );

    assert.ok(
      sonuc.points.every((point) => point.avg >= 0),
      "hiçbir nokta negatif olmamalı",
    );
    // Sıfırlanma aralığı düşürüldüğü için üç yerine iki nokta kalır.
    assert.deepEqual(
      sonuc.points.map((point) => point.ts),
      [110, 130],
    );
  });

  it("sabit sayaçta hız SIFIR olur — atlanmaz", () => {
    // Trafik yokluğu gerçek bir bilgi; sıfırlanmayla karıştırılmamalı.
    const sonuc = counterToRate(seri([[100, 700], [110, 700]]));
    assert.equal(sonuc.points.length, 1);
    assert.equal(sonuc.points[0].avg, 0);
  });

  it("aynı zaman damgalı örnekte sıfıra bölmez", () => {
    const sonuc = counterToRate(seri([[100, 0], [100, 50]]));
    assert.equal(sonuc.points.length, 0);
  });

  it("metrik adını ve etiketi korur", () => {
    const sonuc = counterToRate(seri([[100, 0], [110, 10]]));
    assert.equal(sonuc.metric, "docker.net_rx");
    assert.equal(sonuc.label, "panel");
  });
});

describe("countersToRates", () => {
  it("her seriyi ayrı ayrı çevirir", () => {
    const sonuc = countersToRates([seri([[100, 0], [110, 100]]), seri([[100, 0], [110, 20]])]);
    assert.equal(sonuc.length, 2);
    assert.equal(sonuc[0].points[0].avg, 10);
    assert.equal(sonuc[1].points[0].avg, 2);
  });
});
