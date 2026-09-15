import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  serializeApp,
  serializeBookmark,
  serializeContainer,
  serializeEvent,
  serializeMaintenance,
  serializeMonitor,
} from "./serialize.ts";
import type { ContainerView } from "../docker/types.ts";
import type { AppCard } from "../apps/types.ts";
import type { EventRow } from "../alerts/types.ts";
import type { MaintenanceWindow, MonitorView } from "../monitors/types.ts";
import type { Bookmark } from "../home/bookmarks.ts";

/**
 * Sözleşme testleri.
 *
 * Buradaki `deepEqual`ler kasıtlı olarak TAM eşleşme: bir alan eklenirse ya da
 * adı değişirse test kırılır. İstenen tam olarak bu — v1 şeklinin sessizce
 * değişmemesi, ayrı ad alanının tek gerekçesi.
 */

describe("serializeContainer", () => {
  const view = {
    id: "abc123",
    name: "homeassistant",
    image: "ghcr.io/home-assistant/home-assistant:2026.8",
    imageId: "sha256:deadbeef",
    state: "running",
    status: "Up 3 days (healthy)",
    health: "healthy",
    createdAt: 1787000000,
    ports: [{ hostIp: "0.0.0.0", hostPort: 8123, containerPort: 8123, protocol: "tcp" }],
    composeProject: "ha",
    composeService: "homeassistant",
    labels: { "com.example.secret": "sizmamali" },
    networks: ["ha_default"],
    cpuPct: 3.5,
    memUsed: 512,
    memPct: 12.5,
    restartCount: 2,
    restartsInWindow: 0,
    restartLoopWindowMinutes: 15,
  } as unknown as ContainerView;

  it("kararlı şekli üretir", () => {
    assert.deepEqual(serializeContainer(view), {
      hostId: 1,
      id: "abc123",
      name: "homeassistant",
      image: "ghcr.io/home-assistant/home-assistant:2026.8",
      state: "running",
      status: "Up 3 days (healthy)",
      health: "healthy",
      createdAt: 1787000000,
      ports: [{ hostIp: "0.0.0.0", hostPort: 8123, containerPort: 8123, protocol: "tcp" }],
      compose: { project: "ha", service: "homeassistant" },
      metrics: {
        cpuPercent: 3.5,
        memoryUsedBytes: 512,
        memoryPercent: 12.5,
        restartCount: 2,
        restartsInWindow: 0,
        restartWindowMinutes: 15,
      },
    });
  });

  it("labels / networks / imageId DIŞARI SIZMAZ", () => {
    // Etiketler üçüncü taraf imajların koyduğu her şeyi içeriyor; sözleşmeye
    // girselerdi ileride daraltılamayan bir yüzey açılırdı.
    const json = JSON.stringify(serializeContainer(view));
    assert.ok(!json.includes("sizmamali"), "etiket sızdı");
    assert.ok(!json.includes("ha_default"), "ağ adı sızdı");
    assert.ok(!json.includes("deadbeef"), "imageId sızdı");
  });
});

describe("serializeMonitor", () => {
  const view = {
    id: 7,
    name: "Home Assistant",
    type: "http",
    target: "https://192.168.61.114:8123",
    expected: "",
    enabled: true,
    ignoreTls: false,
    intervalSeconds: null,
    timeoutSeconds: null,
    retries: null,
    downThreshold: null,
    status: "up",
    consecutiveFails: 0,
    consecutiveOk: 42,
    lastCheckAt: 1787872000,
    lastChangeAt: 1787800000,
    lastLatencyMs: 34,
    lastError: null,
    nextCheckAt: 1787872060,
    sortOrder: 1,
    effective: { intervalSeconds: 60, timeoutSeconds: 10, retries: 2, downThreshold: 2 },
    uptime24h: 99.9,
    uptime30d: 99.5,
    days: [{ date: "2026-08-28", upPct: 100, downSeconds: 0, maintenanceSeconds: 0 }],
    inMaintenance: false,
  } as unknown as MonitorView;

  it("çözümlenmiş aralığı verir, null'u değil", () => {
    // İstemci "null = ayardaki global değer" kuralını bilmek zorunda kalmasın.
    const result = serializeMonitor(view);
    assert.equal(result.intervalSeconds, 60);
    assert.equal(result.timeoutSeconds, 10);
  });

  it("60 günlük şeridi dışarı vermez", () => {
    assert.ok(!JSON.stringify(serializeMonitor(view)).includes("2026-08-28"));
  });

  it("hostId taşır", () => {
    assert.equal(serializeMonitor(view).hostId, 1);
  });
});

describe("serializeEvent", () => {
  it("kararlı şekli üretir", () => {
    const row: EventRow = {
      id: 11,
      ts: 1787870000,
      alertKey: "monitor:7",
      source: "monitor",
      severity: "critical",
      title: "Home Assistant erişilemiyor",
      detail: "bağlantı zaman aşımı",
      notifiedChannels: ["email"],
      suppressedReason: null,
      acknowledgedAt: null,
      acknowledgedBy: null,
    };

    assert.deepEqual(serializeEvent(row), {
      hostId: 1,
      id: 11,
      ts: 1787870000,
      severity: "critical",
      source: "monitor",
      alertKey: "monitor:7",
      title: "Home Assistant erişilemiyor",
      detail: "bağlantı zaman aşımı",
      notifiedChannels: ["email"],
      suppressedReason: null,
      acknowledgedAt: null,
      acknowledgedBy: null,
    });
  });
});

describe("serializeApp", () => {
  const card = {
    id: 3,
    categoryId: 1,
    name: "Vaultwarden",
    description: "Parola kasası",
    url: "https://{host}:8222",
    internalUrl: "http://vaultwarden:80",
    icon: "upload:vw.png",
    color: "#175ddc",
    monitorId: 5,
    containerName: "vaultwarden",
    source: "docker",
    widgetType: "",
    widgetConfigured: true,
    openNewTab: true,
    enabled: true,
    showOnLogin: false,
    sortOrder: 2,
  } as unknown as AppCard;

  it("internalUrl ve sunum alanlarını dışarı vermez", () => {
    const json = JSON.stringify(serializeApp(card));
    // internalUrl panelin kendi ağından çözülür; dış istemci için ulaşılamaz
    // bir adres "çalışmayan bağlantı" olarak görünürdü.
    assert.ok(!json.includes("vaultwarden:80"), "internalUrl sızdı");
    assert.ok(!json.includes("upload:vw.png"), "ikon sızdı");
    assert.ok(!json.includes("#175ddc"), "renk sızdı");
  });

  it("ham url'i olduğu gibi verir", () => {
    assert.equal(serializeApp(card).url, "https://{host}:8222");
  });
});

describe("serializeBookmark", () => {
  const bookmark: Bookmark = {
    id: 3,
    group: "Araçlar",
    title: "Router",
    url: "http://192.168.61.1",
    sortOrder: 5,
  };

  it("kararlı şekli üretir", () => {
    assert.deepEqual(serializeBookmark(bookmark), {
      hostId: 1,
      id: 3,
      group: "Araçlar",
      title: "Router",
      url: "http://192.168.61.1",
      sortOrder: 5,
    });
  });
});

describe("serializeMaintenance", () => {
  const weekly: MaintenanceWindow = {
    id: 7,
    name: "Gece bakımı",
    kind: "weekly",
    startsAt: null,
    endsAt: null,
    weekdays: [1, 3, 5],
    startMinute: 180,
    endMinute: 240,
    monitorId: null,
    enabled: true,
    active: false,
  };

  it("kararlı şekli üretir", () => {
    assert.deepEqual(serializeMaintenance(weekly), {
      hostId: 1,
      id: 7,
      name: "Gece bakımı",
      kind: "weekly",
      startsAt: null,
      endsAt: null,
      weekdays: [1, 3, 5],
      startMinute: 180,
      endMinute: 240,
      monitorId: null,
      enabled: true,
      active: false,
    });
  });

  it("hesaplanan `active` alanını DIŞARI VERİR", () => {
    // Diğer türetilmiş alanlar dışarıda tutuldu; bu istisna çünkü cevabı
    // sunucunun saat dilimine bağlı. İstemcinin yeniden hesaplaması, panelin
    // hangi saat diliminde çalıştığını bilmesini gerektirirdi ve yanlış bir
    // "aktif" değeri bakım sırasında alarm üretilmesi demek.
    assert.equal(serializeMaintenance({ ...weekly, active: true }).active, true);
  });
});
