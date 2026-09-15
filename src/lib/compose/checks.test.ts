/**
 * Kurulum öncesi ön kontrollerin sözleşme testleri (M3.19).
 *
 * Seviye ayrımı ürünün kararıdır: "engel" kurulumu durdurur, "uyarı" onay
 * ister, "öneri" hiçbir şeyi engellemez. Bir bulgunun yanlış seviyede olması
 * ya kullanıcıyı çalışabilecek bir kurulumdan alıkoyar, ya da patlayacağını
 * bildiğimiz bir kurulumu sessizce başlatır.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applyFix, blocked, checkCompose, EMPTY_CONTEXT, type CheckContext } from "./checks.ts";
import { parseCompose, readService, stringifyCompose } from "./service.ts";

function belge(text: string) {
  const { doc, error } = parseCompose(text);
  assert.equal(error, null, error ?? "");
  return doc!;
}

function kontrol(text: string, context: CheckContext = EMPTY_CONTEXT) {
  return checkCompose(belge(text), context);
}

function baslik(findings: ReturnType<typeof checkCompose>, parca: string) {
  return findings.find((f) => f.title.includes(parca));
}

const SAGLAM = `services:
  web:
    image: nginx:1.27
    restart: unless-stopped
    logging:
      driver: json-file
    ports:
      - "8080:80"
`;

describe("checkCompose — temiz dosya", () => {
  it("sağlam bir compose'da engel ÜRETMEZ", () => {
    assert.equal(blocked(kontrol(SAGLAM)), false);
  });

  it("sağlam bir compose'da hiç bulgu üretmez", () => {
    assert.deepEqual(kontrol(SAGLAM), []);
  });

  it("services bloğu yoksa engeller", () => {
    const bulgular = kontrol("name: bos\n");
    assert.equal(blocked(bulgular), true);
  });
});

describe("checkCompose — engeller", () => {
  it("build: bloğunu engeller — bu akışta derleme yapılamaz", () => {
    const bulgular = kontrol("services:\n  a:\n    build: .\n");
    assert.equal(baslik(bulgular, "build:")?.severity, "engel");
  });

  it("image ve build yoksa engeller", () => {
    const bulgular = kontrol("services:\n  a:\n    restart: always\n");
    assert.equal(baslik(bulgular, "image tanımlı değil")?.severity, "engel");
  });

  it("panelin kendi portunu ENGELLER, uyarıyla geçiştirmez", () => {
    // Bu portu vermek paneli erişilemez yapar; onayla geçilecek bir şey değil.
    const bulgular = kontrol('services:\n  a:\n    image: x:1\n    ports:\n      - "8443:80"\n', {
      ...EMPTY_CONTEXT,
      panelPorts: [8443, 8080],
    });
    assert.equal(baslik(bulgular, "panelin kendi portu")?.severity, "engel");
  });

  it("aynı portu isteyen iki servisi engeller", () => {
    const bulgular = kontrol(
      'services:\n  a:\n    image: x:1\n    ports:\n      - "9000:80"\n' +
        '  b:\n    image: y:1\n    ports:\n      - "9000:81"\n',
    );
    assert.equal(baslik(bulgular, "iki servis birden")?.severity, "engel");
  });

  it("container_name çakışmasını engeller", () => {
    const bulgular = kontrol("services:\n  a:\n    image: x:1\n    container_name: pihole\n", {
      ...EMPTY_CONTEXT,
      containerNames: ["pihole"],
    });
    assert.equal(baslik(bulgular, "container_name")?.severity, "engel");
  });

  it("var olmayan external ağı engeller", () => {
    const bulgular = kontrol(
      "services:\n  a:\n    image: x:1\nnetworks:\n  disarda:\n    external: true\n",
      { ...EMPTY_CONTEXT, networks: ["baska"] },
    );
    assert.equal(baslik(bulgular, "dış ağ bulunamadı")?.severity, "engel");
  });

  it("external ağ GERÇEKTEN varsa bulgu üretmez", () => {
    const bulgular = kontrol(
      "services:\n  a:\n    image: x:1\n    restart: always\n    logging:\n      driver: json-file\n" +
        "networks:\n  disarda:\n    external: true\n",
      { ...EMPTY_CONTEXT, networks: ["disarda"] },
    );
    assert.equal(baslik(bulgular, "dış ağ"), undefined);
  });

  it("external OLMAYAN ağ için bulgu üretmez — compose onu kendisi yaratır", () => {
    const bulgular = kontrol(
      "services:\n  a:\n    image: x:1\n    restart: always\n    logging:\n      driver: json-file\n" +
        "networks:\n  icerde: {}\n",
    );
    assert.equal(baslik(bulgular, "dış ağ"), undefined);
  });

  /**
   * `networks: null` = "Docker'a sorulamadı". Boş dizi ile karıştırılması,
   * dış ağ kullanan her yığının container popup'ında SAHTE bir engel
   * göstermesine yol açıyordu (compose route'u bağlamı hiç doldurmuyordu).
   */
  it("ağ listesi BİLİNMİYORSA dış ağ kontrolü hiç çalışmaz", () => {
    const bulgular = kontrol(
      "services:\n  a:\n    image: x:1\nnetworks:\n  disarda:\n    external: true\n",
      { ...EMPTY_CONTEXT, networks: null },
    );
    assert.equal(baslik(bulgular, "dış ağ"), undefined);
    assert.equal(blocked(bulgular), false);
  });

  it("EMPTY_CONTEXT bağlam vermeyen çağıranı güvenli tarafa düşürür", () => {
    // Bağlamı doldurmayı unutan bir çağıran, olmayan bir sorunu bildirmemeli.
    assert.equal(EMPTY_CONTEXT.networks, null);
  });
});

describe("checkCompose — uyarılar", () => {
  /**
   * M3.19'da bu bulgu "uyarı"ydı ve gerekçesi "kullanıcı o portu boşaltıyor
   * olabilir"di. passbolt olayı gerekçenin yanlış olduğunu gösterdi: 443'ü
   * caddy tutuyordu, panel uyardı, kullanıcı kaydetti, `compose up` "port is
   * already allocated" ile patladı ve yığın hiç kalkmadı. Portu ŞU AN çalışan
   * başka bir şey tutuyorsa sonuç bir olasılık değil, kesin.
   */
  const PORTLU = 'services:\n  a:\n    image: x:1\n    ports:\n      - "8080:80"\n';

  it("TAZE taramada dolu portu ENGELLER — compose up kesinlikle patlar", () => {
    const bulgular = kontrol(PORTLU, {
      ...EMPTY_CONTEXT,
      reserved: new Map([[8080, "zigbee2mqtt"]]),
      reservedAgeSeconds: 120,
    });
    const bulgu = baslik(bulgular, "zaten kullanımda");
    assert.equal(bulgu?.severity, "engel");
    assert.match(bulgu?.detail ?? "", /zigbee2mqtt/);
    assert.equal(blocked(bulgular), true);
  });

  /**
   * Port taraması saatte bir çalışıyor. Bir saatlik ölçüme dayanarak
   * kullanıcıyı KİLİTLEMEK, veriye hak ettiğinden fazla güvenmek olur —
   * portu az önce boşaltmış olabilir.
   */
  it("BAYAT taramada uyarır ama ENGELLEMEZ ve verinin yaşını söyler", () => {
    const bulgular = kontrol(PORTLU, {
      ...EMPTY_CONTEXT,
      reserved: new Map([[8080, "zigbee2mqtt"]]),
      reservedAgeSeconds: 5 * 60 * 60,
    });
    const bulgu = baslik(bulgular, "zaten kullanımda");
    assert.equal(bulgu?.severity, "uyari");
    assert.match(bulgu?.detail ?? "", /5 saat/);
    assert.equal(blocked(bulgular), false);
  });

  it("tarama hiç yapılmamışsa (yaş null) bulgu ÜRETİLMEZ", () => {
    // reserved zaten boş kalır; yaşın null olması bunu doğrulayan ikinci kapı.
    const bulgular = kontrol(PORTLU, { ...EMPTY_CONTEXT, reservedAgeSeconds: null });
    assert.equal(baslik(bulgular, "zaten kullanımda"), undefined);
  });

  it("EMPTY_CONTEXT tarama yaşını da BİLİNMİYOR kabul eder", () => {
    assert.equal(EMPTY_CONTEXT.reservedAgeSeconds, null);
  });

  it("anonim volume uyarısı verir", () => {
    const bulgular = kontrol("services:\n  a:\n    image: x:1\n    volumes:\n      - /veri\n");
    assert.equal(baslik(bulgular, "anonim volume")?.severity, "uyari");
  });

  it("bind mount'u anonim volume SANMAZ", () => {
    const bulgular = kontrol(
      "services:\n  a:\n    image: x:1\n    volumes:\n      - /host/veri:/veri\n",
    );
    assert.equal(baslik(bulgular, "anonim volume"), undefined);
  });

  it("ham taşınan port için çakışma bakmaz — değerini bilmiyoruz", () => {
    const bulgular = kontrol(
      'services:\n  a:\n    image: x:1\n    ports:\n      - "${PORT}:80"\n',
      { ...EMPTY_CONTEXT, reserved: new Map([[8080, "baska"]]) },
    );
    assert.equal(baslik(bulgular, "zaten kullanımda"), undefined);
  });
});

describe("checkCompose — öneriler", () => {
  it("restart eksikliğini öneri olarak bildirir", () => {
    const bulgular = kontrol("services:\n  a:\n    image: x:1\n");
    const bulgu = baslik(bulgular, "restart politikası");
    assert.equal(bulgu?.severity, "oneri");
    assert.equal(bulgu?.fix?.kind, "restart");
  });

  it("log döndürme eksikliğini öneri olarak bildirir", () => {
    const bulgu = baslik(kontrol("services:\n  a:\n    image: x:1\n"), "log döndürme");
    assert.equal(bulgu?.fix?.kind, "logging");
  });

  it("latest etiketini öneri olarak bildirir", () => {
    assert.equal(
      baslik(kontrol("services:\n  a:\n    image: nginx:latest\n"), "sürüm etiketi")?.severity,
      "oneri",
    );
  });

  it("etiketsiz imajı da sabitlenmemiş sayar", () => {
    assert.ok(baslik(kontrol("services:\n  a:\n    image: nginx\n"), "sürüm etiketi"));
  });

  it("sabitlenmiş sürümde bulgu üretmez", () => {
    assert.equal(baslik(kontrol(SAGLAM), "sürüm etiketi"), undefined);
  });
});

describe("checkCompose — sıralama", () => {
  it("engeller listenin BAŞINDA durur", () => {
    const bulgular = kontrol("services:\n  a:\n    build: .\n    image: x\n");
    assert.equal(bulgular[0].severity, "engel");
  });
});

describe("applyFix", () => {
  it("restart ekler", () => {
    const doc = belge("services:\n  a:\n    image: x:1\n");
    applyFix(doc, "a", "restart");
    assert.equal(readService(doc, "a")?.restart, "unless-stopped");
  });

  it("var olan restart değerini DEĞİŞTİRMEZ", () => {
    // Kullanıcının bilerek yazdığı "no" değerini düzeltmek panelin işi değil.
    const doc = belge("services:\n  a:\n    image: x:1\n    restart: no\n");
    applyFix(doc, "a", "restart");
    assert.equal(readService(doc, "a")?.restart, "no");
  });

  it("log sınırı ekler", () => {
    const doc = belge("services:\n  a:\n    image: x:1\n");
    applyFix(doc, "a", "logging");
    const cikti = stringifyCompose(doc);
    assert.match(cikti, /max-size/);
    assert.match(cikti, /10m/);
  });

  it("düzeltme sonrası ilgili bulgu kaybolur", () => {
    const doc = belge("services:\n  a:\n    image: x:1\n");
    applyFix(doc, "a", "restart");
    assert.equal(baslik(checkCompose(doc), "restart politikası"), undefined);
  });
});
