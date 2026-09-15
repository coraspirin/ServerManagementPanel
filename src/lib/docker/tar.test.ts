/**
 * Tar okuyucu/yazıcının sözleşme testleri (M3.23).
 *
 * Bu modül Docker'ın arşiv ucuyla konuşuyor; ürettiği bayt dizisi yanlışsa
 * hata "dosya bozuk yazıldı" olarak container'ın İÇİNDE ortaya çıkar ve
 * teşhisi zor olur. Bu yüzden asıl iddia GİT-GEL AYNI KALIR.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { readTar, writeTar } from "./tar.ts";

describe("writeTar → readTar", () => {
  it("yazılan dosya aynen geri okunur", () => {
    const veri = Buffer.from("merhaba dünya\n", "utf8");
    const girdiler = readTar(writeTar([{ name: "not.txt", data: veri }]));

    assert.equal(girdiler.length, 1);
    assert.equal(girdiler[0].name, "not.txt");
    assert.equal(girdiler[0].type, "dosya");
    assert.equal(girdiler[0].size, veri.length);
    assert.equal(girdiler[0].data.toString("utf8"), "merhaba dünya\n");
  });

  it("512'nin katı OLMAYAN boyut doğru dolgulanır", () => {
    // Tar blok blok ilerliyor; dolgu yanlışsa sonraki başlık kayar.
    const a = Buffer.alloc(600, 0x41);
    const b = Buffer.from("iki", "utf8");
    const girdiler = readTar(writeTar([
      { name: "a.bin", data: a },
      { name: "b.txt", data: b },
    ]));

    assert.equal(girdiler.length, 2);
    assert.equal(girdiler[0].data.length, 600);
    assert.equal(girdiler[1].data.toString("utf8"), "iki");
  });

  it("tam 512 baytlık dosyada da sonraki girdi bulunur", () => {
    const girdiler = readTar(writeTar([
      { name: "tam.bin", data: Buffer.alloc(512, 7) },
      { name: "son.txt", data: Buffer.from("x") },
    ]));
    assert.deepEqual(girdiler.map((entry) => entry.name), ["tam.bin", "son.txt"]);
  });

  it("boş dosya yazılabilir", () => {
    const girdiler = readTar(writeTar([{ name: "bos", data: Buffer.alloc(0) }]));
    assert.equal(girdiler.length, 1);
    assert.equal(girdiler[0].size, 0);
  });

  it("izin biti korunur", () => {
    const girdiler = readTar(writeTar([{ name: "c.sh", data: Buffer.from("#!"), mode: 0o755 }]));
    assert.equal(girdiler[0].mode, 0o755);
  });

  it("UTF-8 dosya adı bozulmaz", () => {
    const girdiler = readTar(writeTar([{ name: "günlük.txt", data: Buffer.from("a") }]));
    assert.equal(girdiler[0].name, "günlük.txt");
  });

  it("boş arşiv boş liste verir", () => {
    assert.deepEqual(readTar(writeTar([])), []);
  });

  it("bozuk/yarım arşivde PATLAMAZ, okuyabildiğini verir", () => {
    // Ağ kesilirse yarım tar gelebilir; çökmek yerine elde olanı göstermeli.
    const tam = writeTar([{ name: "a.txt", data: Buffer.from("abc") }]);
    const yarim = tam.subarray(0, 700);
    assert.doesNotThrow(() => readTar(yarim));
  });
});

describe("readTar — tür ayrımı", () => {
  /** Test için elle dizin başlığı üreten küçük yardımcı. */
  function dizinArsivi(name: string): Buffer {
    const header = Buffer.alloc(512);
    header.write(name, 0, "utf8");
    header.write("0000755\0", 100, "utf8");
    header.write("00000000000\0", 124, "utf8");
    header.write("00000000000\0", 136, "utf8");
    header.write("5", 156, "utf8");
    header.write("ustar\0", 257, "utf8");
    header.fill(0x20, 148, 156);
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "utf8");
    return Buffer.concat([header, Buffer.alloc(1024)]);
  }

  it("dizini dosyadan ayırır", () => {
    const girdiler = readTar(dizinArsivi("config/"));
    assert.equal(girdiler.length, 1);
    assert.equal(girdiler[0].type, "dizin");
  });
});
