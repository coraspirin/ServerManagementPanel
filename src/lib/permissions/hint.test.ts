import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildHint, helperErrorAction, helperErrorCode, type HintHost } from "./hint.ts";

// Çeviri yerine anahtarı + parametreleri döndüren sahte t: metin değil yapı sınanır.
const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}${JSON.stringify(params)}` : key;

const LOCAL: HintHost = { id: 1, name: "zima", address: null, local: true };
const PI: HintHost = { id: 2, name: "pi", address: "192.168.61.107", local: false };

describe("helper hata metni → ipucu kodu", () => {
  it("helper'ın sabit metinleri eşlenir", () => {
    assert.equal(helperErrorCode("argüman izin verilen desene uymuyor"), "patternDenied");
    assert.equal(helperErrorCode("eylem izinli değil: compose.up"), "actionDisabled");
    assert.equal(helperErrorCode("bilinmeyen eylem: ufw.status"), "helperOutdated");
    assert.equal(helperErrorCode("zaman aşımı"), null);
  });

  it("eylem adı son ':' sonrasından, yalnız geçerli biçimde", () => {
    assert.equal(helperErrorAction("eylem izinli değil: compose.up"), "compose.up");
    assert.equal(helperErrorAction("eylem izinli değil: rm -rf /"), undefined);
    assert.equal(helperErrorAction("izinli değil"), undefined);
  });
});

describe("buildHint", () => {
  it("izin eksikliği panelde düzeltilir, komut yok", () => {
    const hint = buildHint("permission", { host: LOCAL, need: "docker.exec" }, t);
    assert.equal(hint.fix.where, "panel");
    assert.deepEqual(hint.fix.commands, []);
    assert.match(hint.reason, /docker\.exec/);
  });

  it("actionDisabled: eylem allow.conf'a eklenir", () => {
    const hint = buildHint("actionDisabled", { host: LOCAL, action: "power.reboot" }, t);
    assert.equal(hint.fix.where, "host");
    assert.ok(hint.fix.commands.includes("echo 'power.reboot' | sudo tee -a /etc/panel-helper/allow.conf"));
    assert.ok(hint.fix.commands.includes("sudo systemctl restart panel-helper"));
  });

  it("patternDenied: izin satırları heredoc içinde", () => {
    const lines = ["compose.up        ^/DATA/stacks/", "compose.down      ^/DATA/stacks/"];
    const hint = buildHint("patternDenied", { host: PI, allowLines: lines, directory: "/DATA/stacks/x" }, t);
    const start = hint.fix.commands.indexOf("sudo tee -a /etc/panel-helper/allow.conf <<'EOF'");
    assert.ok(start > 0);
    assert.deepEqual(hint.fix.commands.slice(start + 1, start + 3), lines);
    assert.equal(hint.fix.commands[start + 3], "EOF");
  });

  it("komutlar sunucuya özel: yerel ve ajan farklı", () => {
    const local = buildHint("helperMissing", { host: LOCAL }, t);
    const agent = buildHint("helperMissing", { host: PI }, t);
    assert.match(local.fix.commands[0], /permissions\.hint\.where\.local/);
    assert.match(agent.fix.commands[0], /192\.168\.61\.107/);
    // Yerel compose'a helper soketi elle eklenmeli; ajan kitinde zaten var.
    assert.ok(local.fix.commands.some((line) => line.includes("/run/panel-helper:/run/panel-helper")));
    assert.ok(!agent.fix.commands.some((line) => line.includes("/run/panel-helper:/run/panel-helper")));
    assert.equal(agent.hostId, 2);
  });

  it("soket bayatsa doğru servis yeniden oluşturulur", () => {
    assert.ok(buildHint("socketStale", { host: LOCAL }, t).fix.commands.includes("docker compose up -d --force-recreate panel"));
    assert.ok(buildHint("socketStale", { host: PI }, t).fix.commands.includes("docker compose up -d --force-recreate panel-agent"));
  });

  it("dockerMissing: soket mount'u ve DOCKER_GID", () => {
    const hint = buildHint("dockerMissing", { host: PI, feature: "docker" }, t);
    assert.equal(hint.feature, "docker");
    assert.ok(hint.fix.commands.includes("getent group docker | cut -d: -f3"));
    assert.ok(hint.fix.commands.some((line) => line.includes("/var/run/docker.sock:/var/run/docker.sock")));
    assert.equal(hint.fix.commands.at(-1), "docker compose up -d");
  });

  it("sunucu yoksa da üretilir", () => {
    const hint = buildHint("noHost", { host: null }, t);
    assert.equal(hint.hostId, null);
    assert.equal(hint.fix.where, "panel");
  });
});
