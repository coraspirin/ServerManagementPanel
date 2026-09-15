/**
 * Compose port söz diziminin sözleşme testleri (M3.19).
 *
 * Buradaki iddiaların ikisi ürünün kararıdır, ayrıntı değil:
 *
 *   1. BİÇİM KORUNUR — kısa yazılmış port kısa, uzun yazılmış uzun döner.
 *      Aksi hâlde panel, kullanıcının istemediği bir yeniden biçimlendirmeyi
 *      dosyaya yazar ve diff okunamaz hâle gelir.
 *   2. ANLAŞILMAYAN DÜŞÜRÜLMEZ — aralık ve ${DEĞİŞKEN} içeren tanımlar `raw`
 *      olarak taşınır. Anlamadığı satırı atan bir düzenleyici, kullanıcının
 *      yayınını sessizce kapatır.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { editable, formatPortSpec, parsePortSpec } from "./ports.ts";

/** Ayrıştır → geri yaz turu: girdi aynen çıkmalı. */
function tur(value: string): string | Record<string, unknown> {
  return formatPortSpec(parsePortSpec(value));
}

describe("parsePortSpec — kısa biçim", () => {
  it("yalnız container portunu okur", () => {
    const spec = parsePortSpec("80");
    assert.equal(spec.target, 80);
    assert.equal(spec.published, null);
    assert.equal(spec.protocol, "tcp");
  });

  it("yayınlanan portu ayırır", () => {
    const spec = parsePortSpec("8080:80");
    assert.equal(spec.published, 8080);
    assert.equal(spec.target, 80);
  });

  it("protokol sonekini okur", () => {
    assert.equal(parsePortSpec("53:53/udp").protocol, "udp");
  });

  it("IPv4 host adresini ayırır", () => {
    const spec = parsePortSpec("127.0.0.1:8080:80");
    assert.equal(spec.hostIp, "127.0.0.1");
    assert.equal(spec.published, 8080);
    assert.equal(spec.target, 80);
  });

  it("IPv4 host adresi ve protokolü birlikte okur", () => {
    const spec = parsePortSpec("127.0.0.1:8080:80/udp");
    assert.equal(spec.hostIp, "127.0.0.1");
    assert.equal(spec.protocol, "udp");
  });

  it("köşeli parantezli IPv6 adresini ayırır", () => {
    const spec = parsePortSpec("[::1]:8080:80");
    assert.equal(spec.hostIp, "::1");
    assert.equal(spec.published, 8080);
  });

  it("sayı olarak yazılmış portu da kabul eder", () => {
    // YAML'da tırnaksız `- 80` sayı olarak gelir.
    assert.equal(parsePortSpec(80).target, 80);
  });
});

describe("parsePortSpec — anlaşılmayanlar HAM taşınır", () => {
  it("port aralığını ham bırakır", () => {
    const spec = parsePortSpec("3000-3005:3000-3005");
    assert.equal(spec.raw, "3000-3005:3000-3005");
    assert.equal(editable(spec), false);
  });

  it("değişken içeren tanımı ham bırakır", () => {
    assert.equal(parsePortSpec("${PORT}:80").raw, "${PORT}:80");
  });

  it("geçersiz protokolü ham bırakır — sessizce tcp SAYMAZ", () => {
    assert.equal(parsePortSpec("8080:80/sctp").raw, "8080:80/sctp");
  });

  it("aralık dışı port numarasını ham bırakır", () => {
    assert.equal(parsePortSpec("70000:80").raw, "70000:80");
  });

  it("dört parçalı tanımı ham bırakır", () => {
    assert.equal(parsePortSpec("1:2:3:4").raw, "1:2:3:4");
  });

  it("ham tanım geri yazılırken AYNEN döner", () => {
    assert.equal(tur("3000-3005:3000-3005"), "3000-3005:3000-3005");
    assert.equal(tur("${PORT}:80"), "${PORT}:80");
  });
});

describe("parsePortSpec — uzun biçim", () => {
  it("target ve published alanlarını okur", () => {
    const spec = parsePortSpec({ target: 80, published: "8080" });
    assert.equal(spec.target, 80);
    assert.equal(spec.published, 8080);
    assert.equal(spec.form, "long");
  });

  it("published sayı olarak verilse de okur", () => {
    assert.equal(parsePortSpec({ target: 80, published: 8080 }).published, 8080);
  });

  it("published yoksa yayınlanmıyor sayar", () => {
    assert.equal(parsePortSpec({ target: 80 }).published, null);
  });

  it("host_ip ve protocol alanlarını okur", () => {
    const spec = parsePortSpec({ target: 53, published: 53, protocol: "udp", host_ip: "127.0.0.1" });
    assert.equal(spec.protocol, "udp");
    assert.equal(spec.hostIp, "127.0.0.1");
  });

  it("target yoksa ham sayar", () => {
    assert.notEqual(parsePortSpec({ published: "8080" }).raw, null);
  });
});

describe("formatPortSpec — BİÇİM KORUNUR", () => {
  it("kısa yazılmış port kısa döner", () => {
    assert.equal(tur("8080:80"), "8080:80");
    assert.equal(tur("80"), "80");
    assert.equal(tur("53:53/udp"), "53:53/udp");
    assert.equal(tur("127.0.0.1:8080:80"), "127.0.0.1:8080:80");
    assert.equal(tur("[::1]:8080:80"), "[::1]:8080:80");
  });

  it("uzun yazılmış port UZUN döner — kısaya ÇEVİRMEZ", () => {
    const out = formatPortSpec(parsePortSpec({ target: 80, published: "8080" }));
    assert.deepEqual(out, { target: 80, published: "8080" });
  });

  it("uzun biçimde tcp varsayılanı gereksiz yere YAZILMAZ", () => {
    const out = formatPortSpec(parsePortSpec({ target: 80, published: "8080", protocol: "tcp" }));
    assert.equal((out as Record<string, unknown>).protocol, undefined);
  });

  it("yayınlanan port değiştirildiğinde diğer alanlar korunur", () => {
    const spec = parsePortSpec("127.0.0.1:8080:80/udp");
    spec.published = 9090;
    assert.equal(formatPortSpec(spec), "127.0.0.1:9090:80/udp");
  });

  it("yayını kaldırmak yalnızca container portunu bırakır", () => {
    const spec = parsePortSpec("8080:80");
    spec.published = null;
    assert.equal(formatPortSpec(spec), "80");
  });
});
