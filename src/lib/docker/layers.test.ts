/**
 * Katman ayrıştırmasının sözleşme testleri (M3.43).
 *
 * En kritik iddia RUN'IN TANINMASI: Docker `RUN` katmanını komut adıyla
 * yazmıyor, doğrudan kabuk çağrısı olarak bırakıyor (`/bin/sh -c …`). Tanınmazsa
 * imajın boyutunu domine eden katmanlar — ki neredeyse her zaman RUN'dır —
 * listede etiketsiz kalır ve ekranın tek amacı boşa gider.
 *
 * İkincisi NUMARALANDIRMA: Docker geçmişi en yeniden en eskiye veriyor, taban
 * katman dizinin SONUNDA. Numarayı doğrudan indeksten almak, Dockerfile'ın ilk
 * satırını en büyük numarayla göstermek olurdu.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildLayerView, layerTotals, parseInstruction, type LayerInput } from "./layers.ts";

function kat(over: Partial<LayerInput> = {}): LayerInput {
  return { id: "sha256:a", createdAt: 1700000000, createdBy: "", sizeBytes: 0, comment: "", ...over };
}

describe("parseInstruction", () => {
  it("düz komutu ayırır", () => {
    assert.deepEqual(parseInstruction('CMD ["node" "server.js"]'), {
      instruction: "CMD",
      argument: '["node" "server.js"]',
    });
  });

  it("eski Docker'ın #(nop) önekini atar", () => {
    assert.deepEqual(parseInstruction("/bin/sh -c #(nop)  ENV NODE_ENV=production"), {
      instruction: "ENV",
      argument: "NODE_ENV=production",
    });
  });

  it("KABUK ÇAĞRISINI RUN sayar", () => {
    // Docker RUN'ı komut adıyla yazmıyor; tanınmazsa imajın en büyük
    // katmanları etiketsiz kalırdı.
    assert.deepEqual(parseInstruction("/bin/sh -c apk add --no-cache tini"), {
      instruction: "RUN",
      argument: "apk add --no-cache tini",
    });
  });

  it("BuildKit biçimindeki RUN'ı temizler", () => {
    assert.deepEqual(parseInstruction("RUN /bin/sh -c npm ci # buildkit"), {
      instruction: "RUN",
      argument: "npm ci",
    });
  });

  it("BuildKit kuyruğunu diğer komutlardan da atar", () => {
    assert.deepEqual(parseInstruction("COPY dir:9f3a in /app # buildkit"), {
      instruction: "COPY",
      argument: "dir:9f3a in /app",
    });
  });

  it("argümansız komutu tanır", () => {
    assert.deepEqual(parseInstruction("CMD"), { instruction: "CMD", argument: "" });
  });

  it("bilinmeyen metni komutsuz bırakır, ATMAZ", () => {
    // Metin ekranda yine görünmeli: tanımadığımız bir şeyi yutmak, katmanın
    // ne yaptığını tamamen gizlemek olurdu.
    assert.deepEqual(parseInstruction("bilinmeyen bir sey"), {
      instruction: "",
      argument: "bilinmeyen bir sey",
    });
  });

  it("boş girdide çökmez", () => {
    assert.deepEqual(parseInstruction(""), { instruction: "", argument: "" });
    assert.deepEqual(parseInstruction("   "), { instruction: "", argument: "" });
  });

  it("komutla BAŞLAYAN ama komut olmayan metni yanlış etiketlemez", () => {
    // "ADDING" bir komut değil; önek eşleşmesi boşlukla sınırlanmalı.
    assert.equal(parseInstruction("ADDING something").instruction, "");
  });
});

describe("buildLayerView — numaralandırma", () => {
  it("TABAN katmanı 1 numaralar", () => {
    // Docker geçmişi en yeniden en eskiye geliyor: dizinin SONU tabandır.
    const view = buildLayerView([
      kat({ createdBy: "CMD x" }),
      kat({ createdBy: "RUN y" }),
      kat({ createdBy: "FROM z" }),
    ]);
    assert.deepEqual(view.map((entry) => entry.index), [3, 2, 1]);
  });

  it("dizinin SIRASINI değiştirmez", () => {
    const view = buildLayerView([kat({ createdBy: "CMD x" }), kat({ createdBy: "RUN y" })]);
    assert.equal(view[0].instruction, "CMD");
    assert.equal(view[1].instruction, "RUN");
  });
});

describe("buildLayerView — ölçüler", () => {
  const katmanlar = [
    kat({ createdBy: "RUN buyuk", sizeBytes: 200 * 1024 * 1024 }),
    kat({ createdBy: "RUN orta", sizeBytes: 100 * 1024 * 1024 }),
    kat({ createdBy: "COPY kucuk", sizeBytes: 1024 }),
    kat({ createdBy: "ENV A=1", sizeBytes: 0 }),
  ];

  it("çubuk genişliğini EN BÜYÜK katmana göre oranlar", () => {
    const view = buildLayerView(katmanlar);
    assert.equal(view[0].widthPct, 100);
    assert.equal(view[1].widthPct, 50);
  });

  it("payı TOPLAMA göre hesaplar", () => {
    const view = buildLayerView(katmanlar);
    assert.ok(view[0].sharePct > 66 && view[0].sharePct < 67);
  });

  it("baskın katmanı BÜYÜK işaretler", () => {
    const view = buildLayerView(katmanlar);
    assert.equal(view[0].large, true);
    assert.equal(view[1].large, true);
    assert.equal(view[2].large, false);
  });

  it("küçük bir imajda oransal olarak büyük katmanı BÜYÜK saymaz", () => {
    // 9 MB'lık bir katman imajın yarısı olsa bile budanacak bir şey değil;
    // yalnızca orana bakmak yanıltıcı bir damga olurdu.
    const view = buildLayerView([
      kat({ createdBy: "RUN a", sizeBytes: 9 * 1024 * 1024 }),
      kat({ createdBy: "RUN b", sizeBytes: 9 * 1024 * 1024 }),
    ]);
    assert.equal(view[0].large, false);
  });

  it("SIFIR baytlık katmanı da listeler", () => {
    const view = buildLayerView(katmanlar);
    assert.equal(view[3].instruction, "ENV");
    assert.equal(view[3].widthPct, 0);
  });

  it("hepsi sıfır baytken BÖLME HATASI vermez", () => {
    const view = buildLayerView([kat({ createdBy: "ENV A=1" }), kat({ createdBy: "CMD x" })]);
    assert.equal(view[0].widthPct, 0);
    assert.equal(view[0].sharePct, 0);
    assert.equal(view[0].large, false);
  });

  it("boş listede boş sonuç döner", () => {
    assert.deepEqual(buildLayerView([]), []);
  });
});

describe("layerTotals", () => {
  it("sayıyı ve toplam boyutu verir", () => {
    const totals = layerTotals([kat({ sizeBytes: 100 }), kat({ sizeBytes: 250 })]);
    assert.deepEqual(totals, { count: 2, sizeBytes: 350 });
  });

  it("boş listede sıfır döner", () => {
    assert.deepEqual(layerTotals([]), { count: 0, sizeBytes: 0 });
  });
});
