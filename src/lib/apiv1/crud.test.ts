import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appPatchBase,
  bookmarkPatchBase,
  maintenancePatchBase,
  mergePatch,
  monitorPatchBase,
  parseId,
} from "./crud.ts";

/**
 * Bu dosyanın koruduğu şey tek bir cümle: v1'in PATCH'i gönderilmeyen alanı
 * SİLMEZ. Bozulduğunda hiçbir ekran uyarı vermez — istemci `200` alır, kayıt
 * sessizce budanmış olur.
 */

describe("mergePatch", () => {
  it("gönderilmeyen alanı korur", () => {
    const merged = mergePatch({ name: "eski", target: "https://a", enabled: true }, { name: "yeni" });
    assert.deepEqual(merged, { name: "yeni", target: "https://a", enabled: true });
  });

  it("gönderilen alanı üstüne yazar", () => {
    const merged = mergePatch({ enabled: true }, { enabled: false });
    assert.equal(merged.enabled, false);
  });

  it("null GÖNDERMEK bir değerdir — alanı boşaltır", () => {
    // JSON'da `undefined` yok; anahtarın gövdede bulunması istemcinin onu
    // kastettiği anlamına gelir.
    const merged = mergePatch({ intervalSeconds: 30 }, { intervalSeconds: null });
    assert.equal(merged.intervalSeconds, null);
  });

  it("tanınmayan anahtarı reddetmez", () => {
    // "Eklemeler serbest" sözünün karşılığı: bugün anlamsız olan bir alan
    // yarın gerçek olabilir ve eski istemciler o gün hata almamalı.
    const merged = mergePatch({ name: "a" }, { gelecekAlan: 1 });
    assert.equal(merged.gelecekAlan, 1);
    assert.equal(merged.name, "a");
  });

  it("tabanı DEĞİŞTİRMEZ", () => {
    const base = { name: "a" };
    mergePatch(base, { name: "b" });
    assert.equal(base.name, "a");
  });

  it("boş gövde hiçbir şeyi değiştirmez", () => {
    const base = { name: "a", enabled: false };
    assert.deepEqual(mergePatch(base, {}), base);
  });
});

describe("monitorPatchBase", () => {
  const monitor = {
    id: 4,
    name: "HA",
    type: "http" as const,
    target: "https://192.168.61.114:8123",
    expected: "200",
    enabled: false,
    ignoreTls: true,
    intervalSeconds: 30,
    timeoutSeconds: null,
    retries: 2,
    downThreshold: null,
    status: "up" as const,
    consecutiveFails: 0,
    consecutiveOk: 9,
    lastCheckAt: 1_700_000_000,
    lastChangeAt: null,
    lastLatencyMs: 12,
    lastError: null,
    nextCheckAt: 1_700_000_060,
    sortOrder: 3,
  };

  it("yalnızca YAZILABİLİR alanları taşır", () => {
    // Türetilmiş alanlar (`status`, `lastCheckAt`, `sortOrder`) tabana
    // girmemeli: bir gün parseX onlardan birini okumaya başlarsa, istemcinin
    // hiç göndermediği bir değer yazılırdı.
    assert.deepEqual(Object.keys(monitorPatchBase(monitor)).sort(), [
      "downThreshold",
      "enabled",
      "expected",
      "ignoreTls",
      "intervalSeconds",
      "name",
      "retries",
      "target",
      "timeoutSeconds",
      "type",
    ]);
  });

  it("kapalı monitör açılmaz — enabled GERÇEK değeriyle taşınır", () => {
    // `parseMonitorInput` `body.enabled !== false` yazıyor; taban gerçek
    // `false` taşımasaydı her PATCH kapalı monitörü açardı.
    assert.equal(monitorPatchBase(monitor).enabled, false);
  });

  it("null ezmeler null kalır (T9: ayardaki global değer)", () => {
    assert.equal(monitorPatchBase(monitor).timeoutSeconds, null);
    assert.equal(monitorPatchBase(monitor).intervalSeconds, 30);
  });
});

describe("appPatchBase", () => {
  const card = {
    id: 1,
    categoryId: 2,
    name: "Portainer",
    description: "",
    url: "http://{host}:9000",
    internalUrl: "http://portainer:9000",
    icon: "upload:abc.png",
    color: "#2563eb",
    monitorId: null,
    containerName: "portainer",
    source: "docker" as const,
    widgetType: "",
    widgetConfigured: false,
    openNewTab: true,
    enabled: true,
    showOnLogin: true,
    sortOrder: 0,
  };

  it("v1 şeklinde GÖRÜNMEYEN alanları da taşır", () => {
    // `icon`/`color`/`internalUrl` dışarı verilmiyor, dolayısıyla istemci
    // gönderemez. Tabanda olmasalardı v1'den yapılan her PATCH yüklenmiş
    // logoyu ve rengi sıfırlardı.
    const base = appPatchBase(card);
    assert.equal(base.icon, "upload:abc.png");
    assert.equal(base.color, "#2563eb");
    assert.equal(base.internalUrl, "http://portainer:9000");
  });

  it("showOnLogin GERÇEK değeriyle taşınır", () => {
    // `parseAppInput` `body.showOnLogin === true` yazıyor — diğerlerinin
    // TERSİ yönde varsayılan. Taban olmasaydı her PATCH kartı karşılama
    // sayfasından düşürürdü.
    assert.equal(appPatchBase(card).showOnLogin, true);
  });

  it("türetilmiş alanları taşımaz", () => {
    const base = appPatchBase(card);
    assert.equal("source" in base, false);
    assert.equal("widgetType" in base, false);
    assert.equal("widgetConfigured" in base, false);
    assert.equal("sortOrder" in base, false);
  });
});

describe("bookmarkPatchBase", () => {
  it("üç yazılabilir alanı taşır", () => {
    const base = bookmarkPatchBase({
      id: 1,
      group: "Araçlar",
      title: "Router",
      url: "http://192.168.61.1",
      sortOrder: 5,
    });
    assert.deepEqual(base, { group: "Araçlar", title: "Router", url: "http://192.168.61.1" });
  });
});

describe("maintenancePatchBase", () => {
  const weekly = {
    id: 7,
    name: "Gece bakımı",
    kind: "weekly" as const,
    startsAt: null,
    endsAt: null,
    weekdays: [1, 3, 5],
    startMinute: 180,
    endMinute: 240,
    monitorId: null,
    enabled: true,
    active: false,
  };

  it("kind ve weekdays korunur", () => {
    // Kritik: `parseMaintenanceInput` gövdede `kind` yoksa "once" varsayıyor.
    // Taban olmasaydı `{"enabled": false}` göndermek haftalık pencereyi tek
    // seferliğe çevirip günleri silerdi.
    const base = maintenancePatchBase(weekly);
    assert.equal(base.kind, "weekly");
    assert.deepEqual(base.weekdays, [1, 3, 5]);
  });

  it("hesaplanan `active` alanı tabana girmez", () => {
    assert.equal("active" in maintenancePatchBase(weekly), false);
  });

  it("birleştirme sonrası kind hâlâ weekly", () => {
    const merged = mergePatch(maintenancePatchBase(weekly), { enabled: false });
    assert.equal(merged.kind, "weekly");
    assert.deepEqual(merged.weekdays, [1, 3, 5]);
    assert.equal(merged.enabled, false);
  });
});

describe("parseId", () => {
  it("pozitif tamsayıyı kabul eder", () => {
    assert.equal(parseId("42"), 42);
  });

  it("bozuk kimliği reddeder — 404 ile karıştırılmasın diye", () => {
    // `Number("abc")` → NaN ve NaN bir sorguya girdiğinde sessizce "kayıt yok"
    // üretir; istemci kimliğinin bozuk olduğunu değil, kaydın silindiğini
    // sanardı.
    for (const raw of ["abc", "", " ", "1.5", "-3", "0", "1e3abc", "NaN"]) {
      assert.equal(parseId(raw), null, `"${raw}" reddedilmeliydi`);
    }
  });
});
