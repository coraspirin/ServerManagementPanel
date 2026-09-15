/**
 * Image referans ayrıştırmasının sözleşme testleri (M3.39).
 *
 * En kritik iddia KAYIT DEFTERİ PORTU ETİKET SANILMAZ: `localhost:5000/app`
 * içindeki `:5000` bir etiket değil, ana bilgisayarın portu. Karıştırılırsa
 * depo adı `localhost`, etiket `5000/app` olur ve `docker tag` çağrısı ya
 * patlar ya da bambaşka bir imaj yaratır.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { splitReference, validReference } from "./reference.ts";

describe("splitReference", () => {
  it("depo ve etiketi ayırır", () => {
    assert.deepEqual(splitReference("nginx:1.24"), { repo: "nginx", tag: "1.24" });
  });

  it("etiket yoksa latest sayar", () => {
    assert.deepEqual(splitReference("nginx"), { repo: "nginx", tag: "latest" });
  });

  it("KAYIT DEFTERİ PORTUNU etiket sanmaz", () => {
    assert.deepEqual(splitReference("localhost:5000/app"), {
      repo: "localhost:5000/app",
      tag: "latest",
    });
  });

  it("port VE etiket birlikteyken ikisini de doğru ayırır", () => {
    assert.deepEqual(splitReference("localhost:5000/app:2.1"), {
      repo: "localhost:5000/app",
      tag: "2.1",
    });
  });

  it("çok parçalı depo yolunu kabul eder", () => {
    assert.deepEqual(splitReference("ghcr.io/kullanici/uygulama:latest"), {
      repo: "ghcr.io/kullanici/uygulama",
      tag: "latest",
    });
  });

  it("baştaki ve sondaki boşluğu atar", () => {
    assert.deepEqual(splitReference("  nginx:1.24  "), { repo: "nginx", tag: "1.24" });
  });

  it("BOŞ girdiyi reddeder", () => {
    assert.equal(validReference(""), null);
    assert.equal(validReference("   "), null);
  });

  it("geçersiz etiket karakterini REDDEDER", () => {
    assert.equal(validReference("nginx:1 2"), null);
    assert.equal(validReference("nginx:sür!m"), null);
  });

  it("geçersiz KAYIT DEFTERİ ana bilgisayarını reddeder", () => {
    // Eğik çizgi varken iki nokta hiçbir zaman etiket olmuyor, ana bilgisayar
    // oluyor — o hâlde ana bilgisayar da doğrulanmak zorunda.
    assert.equal(validReference("nginx:sürüm/1"), null);
  });

  it("geçerli kayıt defteri ana bilgisayarını kabul eder", () => {
    assert.deepEqual(validReference("localhost:5000/app:2.1"), {
      repo: "localhost:5000/app",
      tag: "2.1",
    });
    assert.deepEqual(validReference("ghcr.io/kullanici/uygulama"), {
      repo: "ghcr.io/kullanici/uygulama",
      tag: "latest",
    });
  });

  it("BÜYÜK harfli depo adını reddeder", () => {
    // Docker depo adları küçük harf; büyük harfli bir ad `docker tag`ta hata.
    assert.equal(validReference("Nginx"), null);
  });

  it("etikette BÜYÜK harfe izin verir", () => {
    // Depo adının aksine etiket büyük harf kabul ediyor (`v1.2-RC1`).
    assert.deepEqual(validReference("nginx:v1.2-RC1"), { repo: "nginx", tag: "v1.2-RC1" });
  });

  it("etiketle başlayan geçersiz biçimi reddeder", () => {
    assert.equal(validReference(":1.24"), null);
  });
});
