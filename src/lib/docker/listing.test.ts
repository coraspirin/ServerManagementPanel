/**
 * Container dizin listesi ayrıştırmasının sözleşme testleri (M3.23).
 *
 * `ls -la` çıktısının biçimi GNU coreutils ile busybox arasında farklılık
 * gösteriyor ve container'ların çoğu busybox kullanıyor. Yanlış ayrıştırma,
 * kullanıcıya var olmayan bir dosya sistemi göstermek demek.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { looksLikeMissingLs, normalizePath, parseListing, writeBlocked } from "./listing.ts";

const GNU = `total 24
drwxr-xr-x 1 root root 4096 May 16 14:42 .
drwxr-xr-x 1 root root 4096 May 16 14:42 ..
-rw-r--r-- 1 root root  220 Apr  8 06:30 config.yml
drwx------ 1 1000 1000 4096 Jun  8 07:52 gizli
lrwxrwxrwx 1 root root    7 May 16 14:42 bin -> usr/bin
-rwxr-xr-x 1 root root 1234 May 16 14:42 basla.sh
`;

describe("parseListing", () => {
  it("dosya, dizin ve sembolik bağı ayırt eder", () => {
    const girdiler = parseListing(GNU, "/veri");
    const tur = (name: string) => girdiler.find((entry) => entry.name === name)?.type;

    assert.equal(tur("config.yml"), "dosya");
    assert.equal(tur("gizli"), "dizin");
    assert.equal(tur("bin"), "sembolik");
  });

  it(". ve .. satırlarını ATAR", () => {
    const adlar = parseListing(GNU, "/veri").map((entry) => entry.name);
    assert.ok(!adlar.includes("."));
    assert.ok(!adlar.includes(".."));
  });

  it("'total' satırını atar", () => {
    assert.ok(!parseListing(GNU, "/").some((entry) => entry.name === "24"));
  });

  it("sembolik bağın HEDEFİNİ ayırır, ada karıştırmaz", () => {
    const bag = parseListing(GNU, "/")?.find((entry) => entry.name === "bin");
    assert.equal(bag?.linkTarget, "usr/bin");
    assert.equal(bag?.name, "bin");
  });

  it("boyut, izin ve sahibi okur", () => {
    const dosya = parseListing(GNU, "/veri").find((entry) => entry.name === "config.yml");
    assert.equal(dosya?.size, 220);
    assert.equal(dosya?.permissions, "rw-r--r--");
    assert.equal(dosya?.owner, "root:root");
  });

  it("tam yolu dizinle birleştirir", () => {
    const dosya = parseListing(GNU, "/veri").find((entry) => entry.name === "config.yml");
    assert.equal(dosya?.path, "/veri/config.yml");
  });

  it("kök dizinde çift eğik çizgi üretmez", () => {
    const dosya = parseListing(GNU, "/").find((entry) => entry.name === "config.yml");
    assert.equal(dosya?.path, "/config.yml");
  });

  it("DİZİNLER ÖNCE sıralanır", () => {
    const girdiler = parseListing(GNU, "/");
    const ilkDosya = girdiler.findIndex((entry) => entry.type !== "dizin");
    const sonDizin = girdiler.map((entry) => entry.type).lastIndexOf("dizin");
    assert.ok(sonDizin < ilkDosya);
  });

  it("boşluk içeren dosya adını bölmez", () => {
    const cikti = "-rw-r--r-- 1 root root 10 May 16 14:42 iki kelime.txt\n";
    assert.equal(parseListing(cikti, "/")[0].name, "iki kelime.txt");
  });

  it("busybox çıktısını da okur", () => {
    // busybox tarih sütununu farklı hizalar ama alan sayısı aynı kalır.
    const busybox =
      "-rw-r--r--    1 root     root           220 Apr  8 06:30 config.yml\n" +
      "drwxr-xr-x    2 root     root          4096 Apr  8 06:30 etc\n";
    const girdiler = parseListing(busybox, "/");
    assert.equal(girdiler.length, 2);
    assert.equal(girdiler[0].name, "etc");
    assert.equal(girdiler[1].size, 220);
  });

  it("anlamsız satırlarda PATLAMAZ, onları atlar", () => {
    const girdiler = parseListing("ls: cannot open directory\nrastgele metin\n", "/");
    assert.deepEqual(girdiler, []);
  });
});

describe("normalizePath", () => {
  it("her zaman kökten başlar", () => {
    assert.equal(normalizePath("veri"), "/veri");
  });

  it("boş girdi kök olur", () => {
    assert.equal(normalizePath(""), "/");
  });

  it(".. ile YUKARI ÇIKAMAZ", () => {
    // Dizin dışına dolaşma girişimi kökte durur.
    assert.equal(normalizePath("/../../etc"), "/etc");
    assert.equal(normalizePath("/veri/../.."), "/");
  });

  it("çoklu eğik çizgiyi sadeleştirir", () => {
    assert.equal(normalizePath("//veri///alt//"), "/veri/alt");
  });
});

describe("writeBlocked", () => {
  it("/proc, /sys ve /dev yazmaya KAPALI", () => {
    assert.equal(writeBlocked("/proc/1/mem"), true);
    assert.equal(writeBlocked("/sys"), true);
    assert.equal(writeBlocked("/dev/sda"), true);
  });

  it("benzer adlı sıradan dizinleri engellemez", () => {
    // "/proclama" /proc değil; ön ek karşılaştırması sınırı doğru çizmeli.
    assert.equal(writeBlocked("/proclama/dosya"), false);
    assert.equal(writeBlocked("/etc/nginx.conf"), false);
  });
});

describe("looksLikeMissingLs", () => {
  it("ls bulunamadı hatasını tanır", () => {
    assert.equal(
      looksLikeMissingLs('OCI runtime exec failed: exec failed: unable to start container process: exec: "ls": executable file not found in $PATH'),
      true,
    );
  });

  it("sıradan 'dizin yok' hatasını ls eksikliği SANMAZ", () => {
    assert.equal(looksLikeMissingLs("ls: /yok: No such file or directory"), false);
  });
});
