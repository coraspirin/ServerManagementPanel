/**
 * ANSI çözümlemesinin sözleşme testleri (M3.34).
 *
 * En kritik iddia TANINMAYAN DİZİ HAM BASILMAZ: imleç taşıma ve ekran
 * temizleme dizilerini metin olarak basmak, düzeltmeye çalıştığımız sorunun
 * ta kendisi. İkincisi AKIŞ ORTASINDA KESİLMİŞ dizide çökmemek — canlı log
 * akışında bir satır iki parçaya bölünebiliyor.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseAnsi, stripAnsi } from "./ansi.ts";

const E = "\u001b";

/** Parçaların metinlerini birleştirir — görünen çıktı bu. */
function metin(input: string): string {
  return parseAnsi(input)
    .map((span) => span.text)
    .join("");
}

describe("parseAnsi — renk", () => {
  it("temel rengi parçaya çevirir", () => {
    const spans = parseAnsi(`${E}[32mTAMAM${E}[0m`);
    assert.equal(spans.length, 1);
    assert.equal(spans[0].text, "TAMAM");
    assert.equal(spans[0].fg, "green");
  });

  it("sıfırlamadan sonraki metni RENKSİZ bırakır", () => {
    const spans = parseAnsi(`${E}[31mHATA${E}[0m devam`);
    assert.equal(spans[0].fg, "red");
    assert.equal(spans[1].fg, null);
    assert.equal(spans[1].text, " devam");
  });

  it("parlak renkleri ayırır", () => {
    assert.equal(parseAnsi(`${E}[91mkırmızı`)[0].fg, "brightred");
  });

  it("arka plan rengini ayrı tutar", () => {
    const span = parseAnsi(`${E}[41mdikkat`)[0];
    assert.equal(span.bg, "red");
    assert.equal(span.fg, null);
  });

  it("kalın ve altı çiziliyi okur", () => {
    const span = parseAnsi(`${E}[1;4mbaşlık`)[0];
    assert.equal(span.bold, true);
    assert.equal(span.underline, true);
  });

  it("256 renk küpünü hex'e çevirir", () => {
    // 196 = saf kırmızı (küpün 5,0,0 köşesi).
    assert.equal(parseAnsi(`${E}[38;5;196mx`)[0].fg, "#ff0000");
  });

  it("256 paletinin ilk 16'sını AD olarak bırakır", () => {
    // Bu renkler temaya göre değişir; hex'e çevirmek temayı yok sayardı.
    assert.equal(parseAnsi(`${E}[38;5;1mx`)[0].fg, "red");
  });

  it("truecolor'ı okur", () => {
    assert.equal(parseAnsi(`${E}[38;2;18;52;86mx`)[0].fg, "#123456");
  });

  it("parametresiz `[m`'i sıfırlama sayar", () => {
    const spans = parseAnsi(`${E}[31mkırmızı${E}[mnormal`);
    assert.equal(spans[1].fg, null);
  });
});

describe("parseAnsi — tanınmayan diziler", () => {
  it("imleç taşımayı ATAR, basmaz", () => {
    assert.equal(metin(`${E}[2Ayukarı`), "yukarı");
  });

  it("ekran temizlemeyi ATAR", () => {
    assert.equal(metin(`${E}[2Jtemiz`), "temiz");
  });

  it("pencere başlığını (OSC) ATAR", () => {
    assert.equal(metin(`${E}]0;başlık${E}${String.fromCharCode(7)}metin`), "metin");
  });

  it("OSC'yi ST ile biterse de ATAR", () => {
    assert.equal(metin(`${E}]0;başlık${E}${String.fromCharCode(92)}metin`), "metin");
  });

  it("iki baytlık kaçışı ATAR", () => {
    assert.equal(metin(`${E}csonra`), "sonra");
  });
});

describe("parseAnsi — dayanıklılık", () => {
  it("satır sonunda KESİLMİŞ dizide çökmez", () => {
    // Canlı akışta bir satır iki parçaya bölünebiliyor.
    assert.equal(metin(`metin${E}[3`), "metin");
    assert.equal(metin(`metin${E}`), "metin");
    assert.equal(metin(`metin${E}[`), "metin");
  });

  it("kaçış dizisi olmayan satırı olduğu gibi verir", () => {
    const spans = parseAnsi("düz metin");
    assert.equal(spans.length, 1);
    assert.equal(spans[0].text, "düz metin");
  });

  it("boş girdide boş dizi döner", () => {
    assert.deepEqual(parseAnsi(""), []);
  });

  it("yalnızca kaçış dizisi olan satırda boş dizi döner", () => {
    assert.deepEqual(parseAnsi(`${E}[0m`), []);
  });

  it("AYNI biçimdeki ardışık parçaları birleştirir", () => {
    // Her karakter için ayrı bir span üretmek uzun logda tarayıcıyı çökertir.
    const spans = parseAnsi(`${E}[32mbir${E}[32miki`);
    assert.equal(spans.length, 1);
    assert.equal(spans[0].text, "biriki");
  });

  it("TANINMAYAN SGR kodunu yok sayar", () => {
    // 999 diye bir biçim yok; diziyi düşürüp metni bırakmak doğru olan.
    const spans = parseAnsi(`${E}[999mmetin`);
    assert.equal(spans[0].text, "metin");
    assert.equal(spans[0].fg, null);
  });

  it("BOŞ parametreyi sıfır sayar", () => {
    // `[;31m` geçerli: boş parametre 0 demek, yani önce sıfırla sonra kırmızı.
    assert.equal(parseAnsi(`${E}[;31mmetin`)[0].fg, "red");
  });
});

describe("stripAnsi", () => {
  it("biçimi atıp metni bırakır — log indirmede kullanılıyor", () => {
    assert.equal(stripAnsi(`${E}[32mTAMAM${E}[0m hazır`), "TAMAM hazır");
  });
});
