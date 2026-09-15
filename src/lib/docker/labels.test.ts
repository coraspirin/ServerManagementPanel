/**
 * Panel etiketlerinin sözleşme testleri (M3.27).
 *
 * En kritik iddia TANINMAYAN DEĞER VARSAYILANA DÜŞER: bir yazım hatası
 * yüzünden container'ın gizlenmesi ya da güncellemeden düşmesi, sessiz ve
 * teşhisi zor bir sürpriz olurdu. İkincisi `javascript:` şemasının bağlantı
 * olarak kabul EDİLMEMESİ — etiket değeri compose dosyasından geliyor.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  containerLink,
  flag,
  hidden,
  imagePrunable,
  notifiable,
  order,
  parseLink,
  portLink,
  updatable,
} from "./labels.ts";

describe("flag", () => {
  it("true/yes/1/on değerlerini DOĞRU okur", () => {
    for (const value of ["true", "TRUE", "True", "yes", "YES", "1", "on", "evet"]) {
      assert.equal(flag({ x: value }, "x", false), true, `${value} true olmalıydı`);
    }
  });

  it("false/no/0/off değerlerini DOĞRU okur", () => {
    for (const value of ["false", "FALSE", "False", "no", "NO", "0", "off", "hayır"]) {
      assert.equal(flag({ x: value }, "x", true), false, `${value} false olmalıydı`);
    }
  });

  it("baştaki ve sondaki boşluğu yok sayar", () => {
    assert.equal(flag({ x: "  true  " }, "x", false), true);
  });

  it("TANINMAYAN değer VARSAYILANA düşer", () => {
    // "ture" yazım hatası container'ı sessizce gizlememeli.
    assert.equal(flag({ x: "ture" }, "x", true), true);
    assert.equal(flag({ x: "ture" }, "x", false), false);
  });

  it("etiket yoksa varsayılan döner", () => {
    assert.equal(flag({}, "x", true), true);
    assert.equal(flag(null, "x", false), false);
    assert.equal(flag(undefined, "x", true), true);
  });
});

describe("davranış bayrakları", () => {
  it("etiketsiz container BUGÜNKÜ davranışı korur", () => {
    // Opt-out modelinin sözleşmesi: hiçbir etiketi olmayan container hiçbir
    // şekilde etkilenmemeli.
    assert.equal(updatable({}), true);
    assert.equal(hidden({}), false);
    assert.equal(notifiable({}), true);
    assert.equal(imagePrunable({}), true);
    assert.equal(order({}), 0);
  });

  it("panel.update=false güncellemeden çıkarır", () => {
    assert.equal(updatable({ "panel.update": "false" }), false);
  });

  it("panel.hidden=true gizler", () => {
    assert.equal(hidden({ "panel.hidden": "true" }), true);
  });

  it("panel.notify=false bildirimi kapatır", () => {
    assert.equal(notifiable({ "panel.notify": "no" }), false);
  });

  it("panel.prune=false imajı budamadan korur", () => {
    assert.equal(imagePrunable({ "panel.prune": "false" }), false);
  });
});

describe("order", () => {
  it("tam sayıyı okur", () => {
    assert.equal(order({ "panel.order": "5" }), 5);
  });

  it("negatif sayıyı okur — öne almak için", () => {
    assert.equal(order({ "panel.order": "-1" }), -1);
  });

  it("sayı olmayan değeri 0 sayar", () => {
    assert.equal(order({ "panel.order": "ilk" }), 0);
  });
});

describe("parseLink", () => {
  it("düz URL'i kabul eder ve yedek adı kullanır", () => {
    assert.deepEqual(parseLink("https://ornek.local", "uygulama"), {
      label: "uygulama",
      url: "https://ornek.local",
    });
  });

  it("[İsim](url) biçimini ayrıştırır", () => {
    assert.deepEqual(parseLink("[Home Assistant](http://ha.local:8123)", "x"), {
      label: "Home Assistant",
      url: "http://ha.local:8123",
    });
  });

  it("javascript: şemasını REDDEDER", () => {
    // Etiket compose dosyasından geliyor ve arayüzde href'e dönüşüyor;
    // dosyayı düzenleyebilen birine betik çalıştırma imkânı verilmemeli.
    assert.equal(parseLink("javascript:alert(1)", "x"), null);
    assert.equal(parseLink("[Tıkla](javascript:alert(1))", "x"), null);
  });

  it("http/https dışındaki şemaları REDDEDER", () => {
    assert.equal(parseLink("file:///etc/passwd", "x"), null);
    assert.equal(parseLink("data:text/html,<b>x</b>", "x"), null);
    assert.equal(parseLink("ornek.local", "x"), null, "şemasız adres kabul edilmemeli");
  });

  it("boş değerde null döner", () => {
    assert.equal(parseLink("", "x"), null);
    assert.equal(parseLink("   ", "x"), null);
    assert.equal(parseLink(undefined, "x"), null);
  });

  it("boş isimli markdown'da yedek ada düşer", () => {
    assert.deepEqual(parseLink("[](https://a.local)", "yedek"), {
      label: "yedek",
      url: "https://a.local",
    });
  });
});

describe("containerLink / portLink", () => {
  it("container bağlantısını okur", () => {
    const link = containerLink({ "panel.url": "https://ha.local" }, "homeassistant");
    assert.equal(link?.url, "https://ha.local");
  });

  it("port bağlantısı DOĞRU portu okur", () => {
    const labels = {
      "panel.port.8080.url": "https://a.local",
      "panel.port.9090.url": "https://b.local",
    };
    assert.equal(portLink(labels, 9090, "x")?.url, "https://b.local");
    assert.equal(portLink(labels, 1234, "x"), null);
  });
});
