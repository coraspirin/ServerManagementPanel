import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  clearIdempotency,
  helperRequestId,
  isValidKey,
  recall,
  remember,
} from "./idempotency.ts";

describe("isValidKey", () => {
  it("makul anahtarları kabul eder", () => {
    for (const key of ["gece-bakim", "a", "job.2026-08-28", "ci:build:42", "A_b-C.9"]) {
      assert.equal(isValidKey(key), true, `"${key}" kabul edilmeliydi`);
    }
  });

  it("128 karakteri aşanı reddeder", () => {
    // Sınır bellek doldurmaya karşı: anahtarı İSTEMCİ uyduruyor.
    assert.equal(isValidKey("x".repeat(128)), true);
    assert.equal(isValidKey("x".repeat(129)), false);
  });

  it("boşu ve tehlikeli karakterleri reddeder", () => {
    for (const key of ["", " ", "a b", "a\nb", "a/b", "a=b", "türkçe", "a;b"]) {
      assert.equal(isValidKey(key), false, `"${key}" reddedilmeliydi`);
    }
  });
});

describe("recall / remember", () => {
  beforeEach(() => clearIdempotency());

  it("kaydedilen yanıtı geri verir", () => {
    remember(1, "k1", { status: 202, body: '{"taskId":"tsk_1"}' }, 300);
    assert.deepEqual(recall(1, "k1", 300), { status: 202, body: '{"taskId":"tsk_1"}' });
  });

  it("kaydı olmayan anahtar için null", () => {
    assert.equal(recall(1, "yok", 300), null);
  });

  it("KULLANICIYA GÖRE ayrılmış", () => {
    // İki istemcinin aynı tahmin edilebilir adı ("gece-bakim") seçmesi,
    // birbirinin yanıtını görmesine yol açmamalı.
    remember(1, "gece-bakim", { status: 200, body: "birinci" }, 300);
    assert.equal(recall(2, "gece-bakim", 300), null);
    assert.equal(recall(1, "gece-bakim", 300)?.body, "birinci");
  });

  it("pencere geçince kayıt düşer", () => {
    const t0 = 1_700_000_000_000;
    remember(1, "eski", { status: 200, body: "x" }, 300, t0);

    // Pencere içinde: hâlâ orada.
    assert.ok(recall(1, "eski", 300, t0 + 299_000));
    // Pencere dolduktan sonra: düşmüş.
    assert.equal(recall(1, "eski", 300, t0 + 301_000), null);
  });
});

describe("helperRequestId", () => {
  it("helper'ın beklediği biçim: 32 hex karakter", () => {
    const id = helperRequestId("gece-bakim", "gizli");
    assert.match(id, /^[0-9a-f]{32}$/);
  });

  it("AYNI anahtar AYNI id'yi üretir", () => {
    // Garanti buna dayanıyor: panel yeniden başlasa bile ikinci istek
    // helper'ın kendi tekrar penceresine çarpar.
    assert.equal(helperRequestId("k", "gizli"), helperRequestId("k", "gizli"));
  });

  it("farklı anahtar farklı id üretir", () => {
    assert.notEqual(helperRequestId("k1", "gizli"), helperRequestId("k2", "gizli"));
  });

  it("anahtarı geriye çıkarılamaz hâle getirir", () => {
    // HMAC kullanılıyor: id'ler soket üzerinden gidiyor ve kullanıcının
    // seçtiği (tahmin edilebilir olabilecek) ad sızmamalı.
    assert.ok(!helperRequestId("gece-bakim", "gizli").includes("gece"));
  });

  it("sır değişince id değişir", () => {
    assert.notEqual(helperRequestId("k", "sir1"), helperRequestId("k", "sir2"));
  });
});
