/**
 * Compose belgesi düzenlemenin sözleşme testleri (M3.19).
 *
 * En kritik iddia YORUM KORUNUR: panel, kullanıcının elle yazdığı bir dosyayı
 * tek bir portu değiştirmek için yeniden biçimlendirirse, diff okunamaz hâle
 * gelir ve kullanıcı panelin ne yaptığını denetleyemez. Denetlenemeyen bir
 * düzenleyiciye compose dosyası emanet edilmez.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parsePortSpec } from "./ports.ts";
import {
  networkMode,
  parseCompose,
  readAllServices,
  readService,
  serviceNames,
  setServiceEnvironment,
  setServiceNetworks,
  setServicePorts,
  setServiceRestart,
  stringifyCompose,
} from "./service.ts";

const ORNEK = `# Ev otomasyonu yığını
services:
  # Ana arayüz
  homeassistant:
    image: ghcr.io/home-assistant/home-assistant:stable
    restart: unless-stopped
    ports:
      - "8123:8123"   # web arayüzü
      - "5353:5353/udp"
    volumes:
      - ./config:/config
    environment:
      TZ: Europe/Istanbul

  mqtt:
    image: eclipse-mosquitto:2
    ports:
      - "1883:1883"
`;

function belge(text = ORNEK) {
  const { doc, error } = parseCompose(text);
  assert.equal(error, null);
  assert.ok(doc);
  return doc;
}

describe("parseCompose", () => {
  it("geçerli compose'u okur", () => {
    assert.equal(parseCompose(ORNEK).error, null);
  });

  it("bozuk YAML'da HATA döner, sessizce boş belge VERMEZ", () => {
    // Girintide sekme: YAML'ın kesin olarak reddettiği az sayıdaki durumdan
    // biri. Ayrıştırıcı çoğu bozukluğu toleransla geçtiği için örnek özellikle
    // seçildi.
    const sonuc = parseCompose("services:\n\t- a\n");
    assert.equal(sonuc.doc, null);
    assert.ok(sonuc.error);
  });

  it("eşleme olmayan kökü reddeder", () => {
    assert.equal(parseCompose("- bir\n- iki\n").doc, null);
  });
});

describe("readService", () => {
  it("servis adlarını sırayla verir", () => {
    assert.deepEqual(serviceNames(belge()), ["homeassistant", "mqtt"]);
  });

  it("portları, imajı ve restart politikasını okur", () => {
    const servis = readService(belge(), "homeassistant");
    assert.ok(servis);
    assert.equal(servis.image, "ghcr.io/home-assistant/home-assistant:stable");
    assert.equal(servis.restart, "unless-stopped");
    assert.equal(servis.ports.length, 2);
    assert.equal(servis.ports[0].published, 8123);
    assert.equal(servis.ports[1].protocol, "udp");
  });

  it("eşleme biçimindeki environment'ı okur", () => {
    const servis = readService(belge(), "homeassistant");
    assert.deepEqual(servis?.environment, [{ key: "TZ", value: "Europe/Istanbul" }]);
  });

  it("dizi biçimindeki environment'ı da okur", () => {
    const doc = belge("services:\n  a:\n    environment:\n      - TZ=UTC\n      - BOS\n");
    assert.deepEqual(readService(doc, "a")?.environment, [
      { key: "TZ", value: "UTC" },
      { key: "BOS", value: "" },
    ]);
  });

  it("restart tanımlı değilse BOŞ döner — 'no' UYDURMAZ", () => {
    assert.equal(readService(belge(), "mqtt")?.restart, "");
  });

  it("olmayan servis için null döner", () => {
    assert.equal(readService(belge(), "yok"), null);
  });

  it("tüm servisleri okur", () => {
    assert.equal(readAllServices(belge()).length, 2);
  });
});

describe("setServicePorts — YORUM KORUNUR", () => {
  it("portu değiştirir ama satır sonundaki yorumu SİLMEZ", () => {
    const doc = belge();
    const portlar = readService(doc, "homeassistant")!.ports;
    portlar[0].published = 9123;
    setServicePorts(doc, "homeassistant", portlar);

    const cikti = stringifyCompose(doc);
    assert.match(cikti, /9123:8123/);
    assert.match(cikti, /# web arayüzü/);
  });

  it("dosyanın başındaki ve servis üstündeki yorumları korur", () => {
    const doc = belge();
    const portlar = readService(doc, "mqtt")!.ports;
    portlar[0].published = 1884;
    setServicePorts(doc, "mqtt", portlar);

    const cikti = stringifyCompose(doc);
    assert.match(cikti, /# Ev otomasyonu yığını/);
    assert.match(cikti, /# Ana arayüz/);
  });

  it("başka servise DOKUNMAZ", () => {
    const doc = belge();
    const portlar = readService(doc, "mqtt")!.ports;
    portlar[0].published = 1884;
    setServicePorts(doc, "mqtt", portlar);

    assert.match(stringifyCompose(doc), /8123:8123/);
  });

  it("yeni port eklenebilir", () => {
    const doc = belge();
    const portlar = readService(doc, "mqtt")!.ports;
    portlar.push(parsePortSpec("9001:9001"));
    setServicePorts(doc, "mqtt", portlar);

    assert.equal(readService(doc, "mqtt")?.ports.length, 2);
    assert.match(stringifyCompose(doc), /9001:9001/);
  });

  it("eklenen port TIRNAKLANIR — yoksa YAML onu eşleme sanar", () => {
    // Tırnaksız `- 9001:9001` YAML'da {9001: 9001} eşlemesidir, port değil.
    const doc = belge();
    const portlar = readService(doc, "mqtt")!.ports;
    portlar.push(parsePortSpec("9001:9001"));
    setServicePorts(doc, "mqtt", portlar);

    const tekrar = parseCompose(stringifyCompose(doc));
    assert.equal(tekrar.error, null);
    assert.equal(readService(tekrar.doc!, "mqtt")?.ports[1].published, 9001);
  });

  it("port silinebilir", () => {
    const doc = belge();
    const portlar = readService(doc, "homeassistant")!.ports;
    setServicePorts(doc, "homeassistant", [portlar[0]]);

    assert.equal(readService(doc, "homeassistant")?.ports.length, 1);
    assert.doesNotMatch(stringifyCompose(doc), /5353/);
  });

  it("son port silinince 'ports: []' BIRAKMAZ, anahtarı kaldırır", () => {
    const doc = belge();
    setServicePorts(doc, "mqtt", []);

    const cikti = stringifyCompose(doc);
    assert.doesNotMatch(cikti, /ports:\s*\[\]/);
    assert.equal(readService(doc, "mqtt")?.ports.length, 0);
  });

  it("ports anahtarı hiç yokken eklenebilir", () => {
    const doc = belge("services:\n  a:\n    image: nginx\n");
    setServicePorts(doc, "a", [parsePortSpec("8080:80")]);
    assert.equal(readService(doc, "a")?.ports[0].published, 8080);
  });

  it("olmayan servis için HATA fırlatır — sessizce servis YARATMAZ", () => {
    const doc = belge();
    assert.throws(() => setServicePorts(doc, "yok", []), /servis bulunamadı/);
    assert.deepEqual(serviceNames(doc), ["homeassistant", "mqtt"]);
  });

  it("ham taşınan port satırı aynen geri yazılır", () => {
    const doc = belge('services:\n  a:\n    ports:\n      - "${PORT}:80"\n');
    const portlar = readService(doc, "a")!.ports;
    setServicePorts(doc, "a", portlar);
    assert.match(stringifyCompose(doc), /\$\{PORT\}:80/);
  });
});

describe("setServiceRestart", () => {
  it("politikayı yazar", () => {
    const doc = belge();
    setServiceRestart(doc, "mqtt", "unless-stopped");
    assert.equal(readService(doc, "mqtt")?.restart, "unless-stopped");
  });

  it("boş değer anahtarı kaldırır", () => {
    const doc = belge();
    setServiceRestart(doc, "homeassistant", "");
    assert.equal(readService(doc, "homeassistant")?.restart, "");
    assert.doesNotMatch(stringifyCompose(doc), /restart:/);
  });
});

describe("setServiceNetworks", () => {
  it("servise ağ ekler ve ÜST DÜZEY networks bloğuna da kayıt düşer", () => {
    // Üst düzeyde tanımlanmayan ağ, compose config aşamasında hata verir.
    const doc = belge();
    setServiceNetworks(doc, "mqtt", ["arka"]);

    const cikti = stringifyCompose(doc);
    assert.deepEqual(readService(doc, "mqtt")?.networks, ["arka"]);
    assert.match(cikti, /^networks:/m);
    assert.match(cikti, /^ {2}arka:/m);
  });

  it("var olan ağ tanımının ÜZERİNE YAZMAZ", () => {
    const doc = belge(
      "services:\n  a:\n    image: nginx\nnetworks:\n  arka:\n    external: true\n",
    );
    setServiceNetworks(doc, "a", ["arka"]);
    assert.match(stringifyCompose(doc), /external: true/);
  });

  it("ağ listesi boşalınca anahtarı kaldırır", () => {
    const doc = belge();
    setServiceNetworks(doc, "mqtt", ["arka"]);
    setServiceNetworks(doc, "mqtt", []);
    assert.deepEqual(readService(doc, "mqtt")?.networks, []);
  });

  /**
   * `networks` EŞLEME biçiminde de yazılabiliyor ve M3.19 yalnızca diziyi
   * okuyordu. Sonuç sessiz veri kaybıydı: eşleme biçimli servis "hiçbir ağa
   * bağlı değil" okunuyor, kullanıcı başka bir alanı kaydedince `aliases` ve
   * `ipv4_address` satırları dosyadan siliniyordu.
   */
  const ESLEME =
    "services:\n  a:\n    image: nginx\n    networks:\n      arka:\n" +
    "        aliases:\n          - db\n      on:\n        ipv4_address: 10.0.0.5\n" +
    "networks:\n  arka: {}\n  on: {}\n";

  it("EŞLEME biçimli networks bloğunu adlarıyla okur", () => {
    assert.deepEqual(readService(belge(ESLEME), "a")?.networks, ["arka", "on"]);
  });

  it("eşlemeden bir ağ çıkarılınca kalanın aliases değeri KORUNUR", () => {
    const doc = belge(ESLEME);
    setServiceNetworks(doc, "a", ["arka"]);

    const cikti = stringifyCompose(doc);
    assert.match(cikti, /aliases:/);
    assert.match(cikti, /- db/);
    // Çıkarılan ağ ve onun sabit IP'si gitmeli.
    assert.doesNotMatch(cikti, /ipv4_address/);
    assert.deepEqual(readService(doc, "a")?.networks, ["arka"]);
  });

  it("BİÇİM DEĞİŞMEZ: eşleme eşleme kalır, dizi dizi kalır", () => {
    const esleme = belge(ESLEME);
    setServiceNetworks(esleme, "a", ["arka", "on"]);
    // Eşleme biçiminde ağ adı kendi satırında ve iki nokta ile biter.
    assert.match(stringifyCompose(esleme), /^ {6}arka:/m);

    const dizi = belge("services:\n  a:\n    image: nginx\n    networks:\n      - arka\n");
    setServiceNetworks(dizi, "a", ["yeni"]);
    assert.match(stringifyCompose(dizi), /^ {6}- yeni$/m);
  });

  it("network_mode tanımlıyken ağ yazmayı REDDEDER", () => {
    // Compose'da network_mode ile networks bir arada kullanılamaz; sessizce
    // geçersiz dosya üretmektense hata vermek doğru.
    const doc = belge("services:\n  a:\n    image: nginx\n    network_mode: host\n");
    assert.throws(() => setServiceNetworks(doc, "a", ["arka"]), /network_mode/);
  });
});

describe("setServiceEnvironment", () => {
  it("EŞLEME biçimini korur ve yalnızca değeri değiştirir", () => {
    const doc = belge(
      "services:\n  a:\n    image: nginx\n    environment:\n" +
        "      TZ: Europe/Istanbul  # saat dilimi\n      MOD: dev\n",
    );
    setServiceEnvironment(doc, "a", [
      { key: "TZ", value: "Europe/Istanbul" },
      { key: "MOD", value: "prod" },
    ]);

    const cikti = stringifyCompose(doc);
    assert.match(cikti, /MOD: prod/);
    // Anahtara iliştirilmiş yorum yerinde kalmalı.
    assert.match(cikti, /# saat dilimi/);
    assert.doesNotMatch(cikti, /- TZ=/);
  });

  it("DİZİ biçimini korur", () => {
    const doc = belge(
      "services:\n  a:\n    image: nginx\n    environment:\n      - TZ=Europe/Istanbul\n",
    );
    setServiceEnvironment(doc, "a", [{ key: "TZ", value: "UTC" }]);
    assert.match(stringifyCompose(doc), /^ {6}- TZ=UTC$/m);
  });

  it("hiç yoksa eşleme biçiminde yaratır, hepsi silinince anahtarı kaldırır", () => {
    const doc = belge("services:\n  a:\n    image: nginx\n");
    setServiceEnvironment(doc, "a", [{ key: "TZ", value: "UTC" }]);
    assert.match(stringifyCompose(doc), /^ {4}environment:/m);

    setServiceEnvironment(doc, "a", []);
    assert.doesNotMatch(stringifyCompose(doc), /environment:/);
  });

  it("${DEĞİŞKEN} referansını ÇÖZMEZ, olduğu gibi yazar", () => {
    // Çözmek, .env dosyasındaki bir sırrı compose dosyasına kalıcı yazmak olurdu.
    const doc = belge("services:\n  a:\n    image: nginx\n");
    setServiceEnvironment(doc, "a", [{ key: "PAROLA", value: "${DB_SIFRE}" }]);
    assert.match(stringifyCompose(doc), /\$\{DB_SIFRE\}/);
  });

  it("adı boş olan satırı yok sayar", () => {
    const doc = belge("services:\n  a:\n    image: nginx\n");
    setServiceEnvironment(doc, "a", [
      { key: "", value: "yetim" },
      { key: "TZ", value: "UTC" },
    ]);
    assert.deepEqual(readService(doc, "a")?.environment, [{ key: "TZ", value: "UTC" }]);
  });
});

describe("networkMode", () => {
  it("tanımsızsa boş dize döner", () => {
    assert.equal(networkMode(belge(), "mqtt"), "");
  });

  it("tanımlıysa değeri döner", () => {
    const doc = belge("services:\n  a:\n    image: nginx\n    network_mode: host\n");
    assert.equal(networkMode(doc, "a"), "host");
  });
});
