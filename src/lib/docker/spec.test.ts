/**
 * Container tanımının sözleşme testleri (M3.46).
 *
 * En kritik iddia BOŞ ALANIN GÖVDEYE YAZILMAMASI: Docker'da `Cmd: []` imajın
 * kendi komutunu EZER ve container hiçbir şey çalıştırmadan çıkar. Formda
 * dokunulmamış bir "Komut" alanı ile bilerek boşaltılmış bir alan aynı şey
 * değil; ayrım kaybolursa panel, kullanıcı hiçbir şey yazmadığı için ölü
 * container üretir.
 *
 * İkincisi ÇEVRİLEMEYENİN DÜŞÜRÜLMESİ: compose'daki `${PORT}:80` ya da
 * `3000-3005:3000-3005` tek bir container tanımına çevrilemiyor. Sessizce
 * yanlış bir port açmak yerine satır atlanıyor ve UYARI üretiliyor — uyarı
 * üretilmezse kullanıcı yayınlanmadığını fark etmez.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  emptySpec,
  nameFromImage,
  specFromImage,
  specFromService,
  specProblem,
  splitCommand,
  toCreatePayload,
  type ContainerSpec,
} from "./spec.ts";
import type { ServiceConfig } from "../compose/service.ts";
import { createT } from "../i18n/translate.ts";
import { localeDictionary } from "../../locales/index.ts";

/** Mesajlar Türkçe kaynak dilden: testler metnin kendisini doğruluyor. */
const t = createT(localeDictionary("tr"));

function spec(over: Partial<ContainerSpec> = {}): ContainerSpec {
  return { ...emptySpec(), name: "test", image: "nginx:alpine", ...over };
}

function servis(over: Partial<ServiceConfig> = {}): ServiceConfig {
  return {
    name: "uygulama",
    image: "nginx:alpine",
    ports: [],
    networks: [],
    restart: "",
    volumes: [],
    environment: [],
    ...over,
  };
}

describe("specProblem", () => {
  it("geçerli tanımda sorun bulmaz", () => {
    assert.equal(specProblem(spec(), t), null);
  });

  it("adı ve image'ı zorunlu tutar", () => {
    assert.match(specProblem(spec({ name: "" }), t) ?? "", /adı gerekli/);
    assert.match(specProblem(spec({ image: "" }), t) ?? "", /Image gerekli/);
  });

  it("Docker'ın kabul etmediği adı reddeder", () => {
    // Docker adın harf ya da rakamla başlamasını istiyor; "-web" create
    // çağrısında anlaşılmaz bir 400 döndürürdü.
    assert.notEqual(specProblem(spec({ name: "-web" }), t), null);
    assert.equal(specProblem(spec({ name: "web_1.eski-2" }), t), null);
  });

  it("aralık dışı portu reddeder", () => {
    const problem = specProblem(
      spec({ ports: [{ hostPort: "", hostIp: "", containerPort: "70000", protocol: "tcp" }] }),
      t,
    );
    assert.match(problem ?? "", /Geçersiz container portu/);
  });

  it("host portu BOŞ olabilir — yalnızca içeriden erişilen port geçerli", () => {
    assert.equal(
      specProblem(
        spec({ ports: [{ hostPort: "", hostIp: "", containerPort: "80", protocol: "tcp" }] }),
        t,
      ),
      null,
    );
  });

  it("container içindeki yolun mutlak olmasını ister", () => {
    const problem = specProblem(
      spec({ volumes: [{ source: "veri", target: "data", readOnly: false }] }),
      t,
    );
    assert.match(problem ?? "", /mutlak olmalı/);
  });

  it("ortam değişkeni adında boşluk ve eşittir kabul etmez", () => {
    assert.notEqual(specProblem(spec({ env: [{ key: "A B", value: "1" }] }), t), null);
    assert.notEqual(specProblem(spec({ env: [{ key: "A=B", value: "1" }] }), t), null);
  });
});

describe("splitCommand", () => {
  it("boşluktan böler", () => {
    assert.deepEqual(splitCommand("node server.js"), ["node", "server.js"]);
  });

  it("tırnak içindeki boşluğu KORUR", () => {
    assert.deepEqual(splitCommand('echo "iki kelime"'), ["echo", "iki kelime"]);
  });

  it("boş dizeyi boş diziye çevirir", () => {
    // Bu, `Cmd: []` yazılmamasının dayandığı davranış.
    assert.deepEqual(splitCommand("   "), []);
  });

  it("tırnakla verilmiş BOŞ argümanı düşürmez", () => {
    assert.deepEqual(splitCommand('app ""'), ["app", ""]);
  });
});

describe("toCreatePayload", () => {
  it("dokunulmamış alanları gövdeye HİÇ yazmaz", () => {
    const payload = toCreatePayload(spec());
    for (const key of ["Cmd", "Entrypoint", "Env", "User", "WorkingDir", "Hostname"]) {
      assert.equal(key in payload, false, `${key} yazılmamalıydı`);
    }
  });

  it("port yayınını PortBindings'e, portun kendisini ExposedPorts'a koyar", () => {
    const payload = toCreatePayload(
      spec({
        ports: [{ hostPort: "8080", hostIp: "127.0.0.1", containerPort: "80", protocol: "tcp" }],
      }),
    );
    assert.deepEqual(payload.ExposedPorts, { "80/tcp": {} });
    assert.deepEqual((payload.HostConfig as Record<string, unknown>).PortBindings, {
      "80/tcp": [{ HostIp: "127.0.0.1", HostPort: "8080" }],
    });
  });

  it("host portu boşken YALNIZCA ExposedPorts yazılır", () => {
    const payload = toCreatePayload(
      spec({ ports: [{ hostPort: "", hostIp: "", containerPort: "80", protocol: "udp" }] }),
    );
    assert.deepEqual(payload.ExposedPorts, { "80/udp": {} });
    assert.equal("PortBindings" in (payload.HostConfig as Record<string, unknown>), false);
  });

  it("salt-okunur volume'e :ro ekler", () => {
    const payload = toCreatePayload(
      spec({ volumes: [{ source: "/srv/veri", target: "/data", readOnly: true }] }),
    );
    assert.deepEqual((payload.HostConfig as Record<string, unknown>).Binds, [
      "/srv/veri:/data:ro",
    ]);
  });

  it("on-failure politikasına deneme sınırı koyar", () => {
    const payload = toCreatePayload(spec({ restart: "on-failure" }));
    assert.deepEqual((payload.HostConfig as Record<string, unknown>).RestartPolicy, {
      Name: "on-failure",
      MaximumRetryCount: 5,
    });
  });

  it("YALNIZCA ilk ağı NetworkMode'a yazar", () => {
    // Engine tek çağrıda ikinci ağı sessizce yok sayıyor; kalanları
    // `createContainerFromSpec` oluşturmadan SONRA bağlıyor.
    const payload = toCreatePayload(spec({ networks: ["on", "arka"] }));
    assert.equal((payload.HostConfig as Record<string, unknown>).NetworkMode, "on");
  });

  it("adsız ortam değişkenini atar", () => {
    const payload = toCreatePayload(
      spec({ env: [{ key: "  ", value: "x" }, { key: "TZ", value: "Europe/Istanbul" }] }),
    );
    assert.deepEqual(payload.Env, ["TZ=Europe/Istanbul"]);
  });
});

describe("specFromService", () => {
  it("port, ağ ve ortamı taşır", () => {
    const { spec: out, warnings } = specFromService(
      servis({
        ports: [
          { published: 8080, target: 80, protocol: "tcp", hostIp: "", form: "short", raw: null },
        ],
        networks: ["arka"],
        environment: [{ key: "TZ", value: "Europe/Istanbul" }],
        restart: "unless-stopped",
      }),
      t,
    );

    assert.equal(out.name, "uygulama");
    assert.deepEqual(out.ports, [
      { hostPort: "8080", hostIp: "", containerPort: "80", protocol: "tcp" },
    ]);
    assert.deepEqual(out.networks, ["arka"]);
    assert.deepEqual(out.env, [{ key: "TZ", value: "Europe/Istanbul" }]);
    assert.deepEqual(warnings, []);
  });

  it("ÇÖZÜLEMEYEN portu düşürür ve uyarır", () => {
    const { spec: out, warnings } = specFromService(
      servis({
        ports: [
          { published: null, target: 0, protocol: "tcp", hostIp: "", form: "short", raw: "${PORT}:80" },
        ],
      }),
      t,
    );
    assert.deepEqual(out.ports, []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /\$\{PORT\}:80/);
  });

  it("compose'un sayılı restart biçimindeki sayıyı düşürür", () => {
    const { spec: out } = specFromService(servis({ restart: "on-failure:3" }), t);
    assert.equal(out.restart, "on-failure");
  });

  it("ANONİM volume'ü düşürür ve uyarır", () => {
    // "- /data" kaynağı bilinmeyen bir volume; Engine'e Bind olarak verilemez.
    const { spec: out, warnings } = specFromService(servis({ volumes: ["/data"] }), t);
    assert.deepEqual(out.volumes, []);
    assert.equal(warnings.length, 1);
  });

  it("salt-okunur bind'i çözer", () => {
    const { spec: out } = specFromService(servis({ volumes: ["/srv/veri:/data:ro"] }), t);
    assert.deepEqual(out.volumes, [{ source: "/srv/veri", target: "/data", readOnly: true }]);
  });

  it("image'ı olmayan serviste uyarır — compose onu build ediyor olabilir", () => {
    const { warnings } = specFromService(servis({ image: "" }), t);
    assert.equal(warnings.length, 1);
  });
});

describe("nameFromImage", () => {
  it("kayıt defteri ve etiketi atar", () => {
    assert.equal(nameFromImage("ghcr.io/kullanici/uygulama:2.1"), "uygulama");
  });

  it("digest ile verilen referansı da çözer", () => {
    assert.equal(nameFromImage("nginx@sha256:abc"), "nginx");
  });

  it("adda geçersiz karakter kalmaz", () => {
    assert.equal(nameFromImage("docker.io/Kullanici/Uygulama_X:1"), "uygulama_x");
  });
});

describe("specFromImage", () => {
  it("açık portu alır ama HOST portunu boş bırakır", () => {
    // Aynı sayıyı host'a önermek, o portu zaten dinleyen bir şey varken
    // sessizce çakışan bir container üretirdi.
    const out = specFromImage("nginx:alpine", { Config: { ExposedPorts: { "80/tcp": {} } } });
    assert.deepEqual(out.ports, [
      { hostPort: "", hostIp: "", containerPort: "80", protocol: "tcp" },
    ]);
  });

  it("imajın gürültülü ortam değişkenlerini eler", () => {
    const out = specFromImage("app:1", {
      Config: { Env: ["PATH=/usr/bin", "TZ=Europe/Istanbul"] },
    });
    assert.deepEqual(out.env, [{ key: "TZ", value: "Europe/Istanbul" }]);
  });

  it("imajın volume'üne ad ÖNERİR", () => {
    const out = specFromImage("app:1", { Config: { Volumes: { "/var/lib/veri": {} } } });
    assert.deepEqual(out.volumes, [{ source: "app-veri", target: "/var/lib/veri", readOnly: false }]);
  });

  it("inspect çıktısı beklenmedikse PATLAMAZ", () => {
    const out = specFromImage("app:1", null);
    assert.equal(out.image, "app:1");
    assert.deepEqual(out.ports, []);
  });
});
