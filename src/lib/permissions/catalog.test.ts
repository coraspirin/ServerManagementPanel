import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateFeature,
  evaluateHost,
  FEATURE_CATALOG,
  featuresForPermission,
  type FeatureEntry,
  type FeatureHost,
} from "./catalog.ts";

const t = (key: string) => key;

const ALL = { docker: true, proc: true, hostRoot: true, helper: true };
const LOCAL: FeatureHost = { id: 1, name: "zima", address: null, local: true, capabilities: ALL };
const PI: FeatureHost = { id: 2, name: "pi", address: "192.168.61.107", local: false, capabilities: ALL };

function entry(key: string): FeatureEntry {
  const found = FEATURE_CATALOG.find((item) => item.key === key);
  assert.ok(found, key);
  return found;
}

describe("katalog", () => {
  it("anahtarlar benzersiz", () => {
    const keys = FEATURE_CATALOG.map((item) => item.key);
    assert.equal(new Set(keys).size, keys.length);
  });

  it("izinden ekranlar bulunur", () => {
    assert.deepEqual(
      featuresForPermission("security.view").map((item) => item.key),
      ["ports", "fail2ban", "vulnScan"],
    );
    assert.deepEqual(featuresForPermission("users.manage"), []);
  });
});

describe("evaluateFeature", () => {
  it("her şey varsa ✅", () => {
    const result = evaluateFeature(entry("docker"), PI, t);
    assert.equal(result.state, "ok");
    assert.deepEqual(result.hints, []);
  });

  it("zorunlu yetenek eksikse 🔴 ve eksik başına ipucu", () => {
    const host = { ...PI, capabilities: { ...ALL, docker: false, hostRoot: false } };
    const result = evaluateFeature(entry("backup"), host, t);
    assert.equal(result.state, "off");
    assert.deepEqual(result.hints.map((hint) => hint.code), ["dockerMissing", "hostRootMissing"]);
    assert.equal(result.hints[0].hostId, 2);
    assert.equal(result.hints[0].feature, "backup");
  });

  it("isteğe bağlı yetenek eksikse 🟡", () => {
    const host = { ...PI, capabilities: { ...ALL, docker: false, helper: false } };
    const result = evaluateFeature(entry("logs"), host, t);
    assert.equal(result.state, "partial");
    assert.deepEqual(result.hints.map((hint) => hint.code), ["dockerMissing", "helperMissing"]);
  });

  it("helper eylemleri doğrulanamaz → 🟡 ve izin satırları", () => {
    const result = evaluateFeature(entry("hostPower"), LOCAL, t);
    assert.equal(result.state, "partial");
    assert.equal(result.hints[0].code, "helperUnverified");
    assert.ok(result.hints[0].fix.commands.includes("power.reboot"));
  });

  it("helper yoksa helper isteyen özellik 🔴", () => {
    const host = { ...LOCAL, capabilities: { ...ALL, helper: false } };
    assert.equal(evaluateFeature(entry("hostServices"), host, t).state, "off");
  });

  it("yalnız yerel özellik uzakta 🔴 unsupported", () => {
    const result = evaluateFeature(entry("network"), PI, t);
    assert.equal(result.state, "off");
    assert.equal(result.hints[0].code, "unsupported");
    assert.equal(evaluateFeature(entry("network"), LOCAL, t).state, "ok");
  });

  it("native ajan: op listesinde olmayan özellik 🔴 agentOpMissing, olan çalışır", () => {
    const native: FeatureHost = {
      ...PI,
      capabilities: { docker: false, proc: true, hostRoot: true, helper: false },
      ops: ["agent.hello", "system.info", "metrics.sample", "hardware.report"],
    };
    assert.equal(evaluateFeature(entry("monitoring"), native, t).state, "ok");
    const files = evaluateFeature(entry("files"), native, t);
    assert.equal(files.state, "off");
    assert.equal(files.hints[0].code, "agentOpMissing");
    assert.equal(files.hints[0].fix.where, "panel");
    // Node ajanı liste bildirmez: op denetimi yapılmaz.
    assert.equal(evaluateFeature(entry("files"), { ...PI, ops: null }, t).state, "ok");
  });

  it("native ajan: helper eylemleri politikadan kesin (doğrulanamadı yok)", () => {
    const native: FeatureHost = {
      ...PI,
      native: true,
      capabilities: ALL,
      helperActions: ["service.list", "service.status", "service.restart", "service.start", "service.stop"],
    };
    // Tüm eylemler açık → ✅ (Node'da 🟡 helperUnverified olurdu).
    assert.equal(evaluateFeature(entry("hostServices"), native, t).state, "ok");
    // Hiçbiri açık değil → 🔴 policyMissing, komutlar policy.conf satırı.
    const power = evaluateFeature(entry("hostPower"), native, t);
    assert.equal(power.state, "off");
    assert.equal(power.hints[0].code, "policyMissing");
    assert.ok(power.hints[0].fix.commands.some((line) => line === "allow helper.power.reboot"));
    assert.ok(power.hints[0].fix.commands.some((line) => line.includes("/etc/panel-agent/policy.conf")));
    // Bir kısmı açık → 🟡.
    const partial = evaluateFeature(entry("hostServices"), { ...native, helperActions: ["service.list"] }, t);
    assert.equal(partial.state, "partial");
    assert.equal(partial.hints[0].code, "policyMissing");
  });

  it("evaluateHost tüm katalogu döndürür", () => {
    assert.equal(evaluateHost(PI, t).length, FEATURE_CATALOG.length);
  });
});
