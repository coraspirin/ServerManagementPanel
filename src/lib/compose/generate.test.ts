/**
 * Compose üretiminin sözleşme testleri (M3.31).
 *
 * En kritik iddia GÜRÜLTÜ AYIKLANIYOR: imajdan devralınan cmd/entrypoint/env
 * yazılırsa imaj güncellendiğinde eski değerler geçerli kalır — M3.28'de
 * güncellemede düzelttiğimiz donma hatasının compose tarafındaki hâli.
 *
 * İkincisi ÜRETİLEN METİN GEÇERLİ: kendi ayrıştırıcımızdan geçmeyen bir dosya
 * üretip kullanıcıya vermek, hatayı `docker compose up` anına ertelemek olur.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { generateCompose, serviceNameFrom } from "./generate.ts";
import { parseCompose, readService } from "./service.ts";

const IMAJ = {
  Config: {
    Env: ["PATH=/usr/local/bin:/usr/bin", "NGINX_VERSION=1.24"],
    Cmd: ["nginx", "-g", "daemon off;"],
    Entrypoint: ["/docker-entrypoint.sh"],
    Labels: { maintainer: "NGINX Docker Maintainers" },
  },
};

function container(over: Record<string, unknown> = {}) {
  return {
    Id: "abc123def4567890",
    Name: "/web",
    Image: "sha256:aaaa",
    Config: {
      Image: "nginx:1.24",
      Hostname: "abc123def456",
      Env: ["PATH=/usr/local/bin:/usr/bin", "NGINX_VERSION=1.24"],
      Cmd: ["nginx", "-g", "daemon off;"],
      Entrypoint: ["/docker-entrypoint.sh"],
      Labels: { maintainer: "NGINX Docker Maintainers" },
    },
    HostConfig: { RestartPolicy: { Name: "unless-stopped" }, NetworkMode: "bridge" },
    Mounts: [],
    NetworkSettings: { Networks: { bridge: {} } },
    ...over,
  };
}

function uret(over: Record<string, unknown> = {}, env: "user" | "all" = "user") {
  return generateCompose(container(over), IMAJ, { env });
}

/** Üretilen metni kendi ayrıştırıcımızdan geçirip servisi okur. */
function servis(yaml: string, name = "web") {
  const { doc, error } = parseCompose(yaml);
  assert.equal(error, null, `üretilen compose ayrıştırılamadı: ${error}`);
  assert.ok(doc);
  const config = readService(doc, name);
  assert.ok(config, `${name} servisi bulunamadı`);
  return { doc, config };
}

describe("serviceNameFrom", () => {
  it("baştaki eğik çizgiyi atar", () => {
    assert.equal(serviceNameFrom("/web"), "web");
  });

  it("geçersiz karakterleri tireye çevirir", () => {
    assert.equal(serviceNameFrom("/My App.1"), "my-app-1");
  });

  it("hiçbir şey kalmazsa varsayılan ad verir", () => {
    assert.equal(serviceNameFrom("///"), "servis");
  });
});

describe("generateCompose — temel", () => {
  it("üretilen metin AYRIŞTIRICIMIZDAN geçer", () => {
    const { yaml } = uret();
    const { config } = servis(yaml);
    assert.equal(config.image, "nginx:1.24");
  });

  it("container adını sabitler", () => {
    const { yaml } = uret();
    assert.match(yaml, /container_name: web/);
  });

  it("restart politikasını taşır", () => {
    const { config } = servis(uret().yaml);
    assert.equal(config.restart, "unless-stopped");
  });

  it("restart 'no' ise YAZMAZ — compose'un varsayılanı zaten o", () => {
    const { yaml } = uret({ HostConfig: { RestartPolicy: { Name: "no" }, NetworkMode: "bridge" } });
    assert.ok(!yaml.includes("restart:"));
  });

  it("on-failure'ı deneme sayısıyla yazar", () => {
    const { yaml } = uret({
      HostConfig: {
        RestartPolicy: { Name: "on-failure", MaximumRetryCount: 3 },
        NetworkMode: "bridge",
      },
    });
    assert.match(yaml, /restart: on-failure:3/);
  });
});

describe("generateCompose — gürültü ayıklama", () => {
  it("imajdan devralınan CMD'yi YAZMAZ", () => {
    // Yazılırsa imaj güncellendiğinde yeni komut gelmez.
    const { yaml } = uret();
    assert.ok(!yaml.includes("command:"), yaml);
  });

  it("imajdan devralınan ENTRYPOINT'i YAZMAZ", () => {
    const { yaml } = uret();
    assert.ok(!yaml.includes("entrypoint:"), yaml);
  });

  it("DEĞİŞTİRİLMİŞ komutu yazar", () => {
    const { yaml } = uret({
      Config: { ...container().Config, Cmd: ["nginx", "-g", "daemon off; worker_processes 4;"] },
    });
    assert.match(yaml, /command:/);
  });

  it("imajın ENV'ini düşürür, kullanıcınınkini tutar", () => {
    const { yaml } = uret({
      Config: { ...container().Config, Env: ["PATH=/usr/local/bin:/usr/bin", "TZ=Europe/Istanbul"] },
    });
    assert.match(yaml, /TZ=Europe\/Istanbul/);
    assert.ok(!yaml.includes("PATH="), yaml);
  });

  it("env kipi 'all' iken HEPSİNİ yazar", () => {
    const { yaml } = uret({}, "all");
    assert.match(yaml, /PATH=/);
  });

  it("üretilmiş HOSTNAME'i yazmaz", () => {
    // Docker hostname'e kısa id'yi yazıyor; bu kullanıcının seçimi değil.
    const { yaml } = uret();
    assert.ok(!yaml.includes("hostname:"), yaml);
  });

  it("ELLE verilmiş hostname'i yazar", () => {
    const { yaml } = uret({ Config: { ...container().Config, Hostname: "web.local" } });
    assert.match(yaml, /hostname: web\.local/);
  });

  it("com.docker.compose.* etiketlerini AYIKLAR", () => {
    // Var olmayan bir projeye ait göstermek olurdu; compose onları kendi yazar.
    const { yaml } = uret({
      Config: {
        ...container().Config,
        Labels: {
          "com.docker.compose.project": "eski",
          "com.docker.compose.service": "web",
          "panel.url": "https://ornek",
        },
      },
    });
    assert.ok(!yaml.includes("com.docker.compose"), yaml);
    assert.match(yaml, /panel\.url/);
  });

  it("imajdan gelen etiketi yazmaz", () => {
    const { yaml } = uret();
    assert.ok(!yaml.includes("maintainer"), yaml);
  });
});

describe("generateCompose — portlar", () => {
  it("host portunu eşler", () => {
    const { yaml } = uret({
      HostConfig: {
        RestartPolicy: { Name: "no" },
        NetworkMode: "bridge",
        PortBindings: { "80/tcp": [{ HostIp: "0.0.0.0", HostPort: "8080" }] },
      },
    });
    assert.match(yaml, /- 8080:80/);
  });

  it("YEREL adresi korur", () => {
    // 127.0.0.1'i düşürmek kapalı bir portu dünyaya açmak olurdu.
    const { yaml } = uret({
      HostConfig: {
        RestartPolicy: { Name: "no" },
        NetworkMode: "bridge",
        PortBindings: { "80/tcp": [{ HostIp: "127.0.0.1", HostPort: "8080" }] },
      },
    });
    assert.match(yaml, /127\.0\.0\.1:8080:80/);
  });

  it("UDP protokolünü yazar", () => {
    const { yaml } = uret({
      HostConfig: {
        RestartPolicy: { Name: "no" },
        NetworkMode: "bridge",
        PortBindings: { "53/udp": [{ HostIp: "", HostPort: "53" }] },
      },
    });
    assert.match(yaml, /53:53\/udp/);
  });
});

describe("generateCompose — volume ve ağ", () => {
  it("bind mount'u kaynak:hedef olarak yazar", () => {
    const { yaml } = uret({
      Mounts: [{ Type: "bind", Source: "/srv/web", Destination: "/usr/share/nginx/html", RW: true }],
    });
    assert.match(yaml, /\/srv\/web:\/usr\/share\/nginx\/html/);
  });

  it("salt okunur bağlantıya :ro ekler", () => {
    const { yaml } = uret({
      Mounts: [{ Type: "bind", Source: "/srv/web", Destination: "/html", RW: false }],
    });
    assert.match(yaml, /\/srv\/web:\/html:ro/);
  });

  it("named volume'ü DIŞSAL bildirir", () => {
    // Dışsal değilse compose `<proje>_veri` diye YENİSİNİ yaratır ve container
    // bomboş bir volume ile açılır.
    const { yaml } = uret({
      Mounts: [{ Type: "volume", Name: "veri", Destination: "/data", RW: true }],
    });
    assert.match(yaml, /veri:\/data/);
    assert.match(yaml, /external: true/);
  });

  it("anonim volume için UYARIR", () => {
    const { warnings } = uret({
      Mounts: [{ Type: "volume", Name: "a".repeat(64), Destination: "/data", RW: true }],
    });
    assert.ok(warnings.some((entry) => entry.includes("anonim")), warnings.join(" | "));
  });

  it("bridge ağını yazmaz — Docker'ın varsayılanı", () => {
    const { yaml } = uret();
    assert.ok(!yaml.includes("networks:"), yaml);
  });

  it("özel ağı dışsal olarak bildirir", () => {
    const { yaml } = uret({ NetworkSettings: { Networks: { "server-panel_default": {} } } });
    assert.match(yaml, /server-panel_default/);
    assert.match(yaml, /external: true/);
  });

  it("host ağ kipinde ağ listesi YAZMAZ", () => {
    // `network_mode` ile `networks` compose'da birlikte kullanılamaz.
    const { yaml } = uret({
      HostConfig: { RestartPolicy: { Name: "no" }, NetworkMode: "host" },
      NetworkSettings: { Networks: { host: {} } },
    });
    assert.match(yaml, /network_mode: host/);
    assert.ok(!yaml.includes("networks:"), yaml);
  });
});

describe("generateCompose — dayanıklılık", () => {
  it("BOŞ girdide çökmez", () => {
    const sonuc = generateCompose(null, null, { env: "user" });
    assert.ok(sonuc.yaml.includes("services:"));
    assert.ok(sonuc.warnings.length > 0);
  });

  it("imaj yapılandırması yoksa UYARIR", () => {
    const { warnings } = generateCompose(container(), null, { env: "user" });
    assert.ok(warnings.some((entry) => entry.includes("İmajın yapılandırması")));
  });

  it("healthcheck süresini saniyeye çevirir", () => {
    const { yaml } = uret({
      Config: {
        ...container().Config,
        Healthcheck: { Test: ["CMD", "curl", "-f", "http://localhost"], Interval: 30e9, Retries: 3 },
      },
    });
    assert.match(yaml, /interval: 30s/);
    assert.match(yaml, /retries: 3/);
  });

  it("eski usul --link için UYARIR", () => {
    const { warnings } = uret({
      HostConfig: { RestartPolicy: { Name: "no" }, NetworkMode: "bridge", Links: ["db:db"] },
    });
    assert.ok(warnings.some((entry) => entry.includes("--link")));
  });
});
