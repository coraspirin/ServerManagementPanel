/**
 * Env/label devralmanın sözleşme testleri (M3.28).
 *
 * İki iddia birden tutmak zorunda ve ikisi birbirinin zıddı gibi görünüyor:
 * KULLANICININ AYARI ASLA KAYBOLMAZ ve İMAJIN VARSAYILANI ASLA DONMAZ.
 * Ayrımı yapan tek şey, değerin eski imajınkiyle aynı olup olmadığı.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { imageConfig, inheritEnv, inheritLabels } from "./inherit.ts";

describe("inheritEnv", () => {
  it("imajın varsayılanıyla AYNI olan değişkeni DÜŞÜRÜR", () => {
    // Container APP_VERSION=1.0 taşıyor ama bunu imaj koymuş; taşırsak yeni
    // imajın 2.0'ı hiç görünmez.
    const sonuc = inheritEnv(["APP_VERSION=1.0", "TZ=Europe/Istanbul"], ["APP_VERSION=1.0"]);
    assert.deepEqual(sonuc, ["TZ=Europe/Istanbul"]);
  });

  it("kullanıcının OVERRIDE ettiği değişkeni KORUR", () => {
    // İmaj LOG_LEVEL=info diyor, kullanıcı debug yapmış — bu kaybolamaz.
    const sonuc = inheritEnv(["LOG_LEVEL=debug"], ["LOG_LEVEL=info"]);
    assert.deepEqual(sonuc, ["LOG_LEVEL=debug"]);
  });

  it("yalnızca kullanıcının eklediği anahtarı KORUR", () => {
    const sonuc = inheritEnv(["PAROLA=gizli"], ["PATH=/usr/bin"]);
    assert.deepEqual(sonuc, ["PAROLA=gizli"]);
  });

  it("PATH gibi her imajın verdiği değişkeni tekrarlamaz", () => {
    const sonuc = inheritEnv(["PATH=/usr/bin", "TZ=UTC"], ["PATH=/usr/bin"]);
    assert.deepEqual(sonuc, ["TZ=UTC"]);
  });

  it("değerin İÇİNDEKİ eşittir işaretini bölmez", () => {
    // Base64 ve bağlantı dizeleri sık sık "=" içeriyor.
    const sonuc = inheritEnv(["DSN=pg://a:b@c/d?x=1"], []);
    assert.deepEqual(sonuc, ["DSN=pg://a:b@c/d?x=1"]);
  });

  it("değersiz anahtarı (KEY) doğru ele alır", () => {
    assert.deepEqual(inheritEnv(["BOS"], ["BOS"]), []);
    assert.deepEqual(inheritEnv(["BOS"], []), ["BOS"]);
  });

  it("aynı anahtarın FARKLI değeri korunur — boş değere düşürülmez", () => {
    assert.deepEqual(inheritEnv(["TZ="], ["TZ=UTC"]), ["TZ="]);
  });

  it("boş/eksik girdide PATLAMAZ", () => {
    assert.deepEqual(inheritEnv(null, null), []);
    assert.deepEqual(inheritEnv(undefined, ["A=1"]), []);
    assert.deepEqual(inheritEnv(["A=1"], undefined), ["A=1"]);
  });
});

describe("inheritLabels", () => {
  it("imajın varsayılanıyla aynı label'ı DÜŞÜRÜR", () => {
    // OCI sürüm etiketi imajdan gelir; taşımak sürümü eski göstermek olur.
    const sonuc = inheritLabels(
      { "org.opencontainers.image.version": "1.0" },
      { "org.opencontainers.image.version": "1.0" },
    );
    assert.deepEqual(sonuc, {});
  });

  it("kullanıcının koyduğu label'ı KORUR", () => {
    const sonuc = inheritLabels({ "panel.update": "false" }, {});
    assert.deepEqual(sonuc, { "panel.update": "false" });
  });

  it("com.docker.compose.* etiketlerini imajla AYNI OLSA BİLE korur", () => {
    // Bunlar imajdan gelmiyor, compose'un container kimliği. Kaybolurlarsa
    // panel container'ın hangi yığına ait olduğunu bilemez.
    const compose = {
      "com.docker.compose.project": "passbolt",
      "com.docker.compose.service": "passbolt",
    };
    assert.deepEqual(inheritLabels(compose, compose), compose);
  });

  it("kullanıcının override ettiği imaj label'ını korur", () => {
    const sonuc = inheritLabels({ "maintainer": "ben" }, { "maintainer": "upstream" });
    assert.deepEqual(sonuc, { maintainer: "ben" });
  });

  it("boş/eksik girdide PATLAMAZ", () => {
    assert.deepEqual(inheritLabels(null, null), {});
    assert.deepEqual(inheritLabels(undefined, { a: "1" }), {});
  });
});

describe("imageConfig", () => {
  it("ham inspect çıktısından env ve label okur", () => {
    const sonuc = imageConfig({ Config: { Env: ["A=1"], Labels: { b: "2" } } });
    assert.deepEqual(sonuc.env, ["A=1"]);
    assert.deepEqual(sonuc.labels, { b: "2" });
  });

  it("Labels null olduğunda boş nesne döner — Docker bunu sık yapıyor", () => {
    const sonuc = imageConfig({ Config: { Env: null, Labels: null } });
    assert.deepEqual(sonuc.env, []);
    assert.deepEqual(sonuc.labels, {});
  });

  it("beklenmedik biçimde PATLAMAZ", () => {
    assert.deepEqual(imageConfig(null).env, []);
    assert.deepEqual(imageConfig("metin").labels, {});
    assert.deepEqual(imageConfig({}).env, []);
  });
});
