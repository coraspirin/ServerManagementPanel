/**
 * ufw çıktısı ayrıştırma ve kilitleme koruması testleri (M3.18).
 *
 * `dangerousChange` testleri bu dosyanın asıl sebebi: yanlış bir "sorun yok"
 * cevabı, kullanıcının sunucusuna erişimini kalıcı olarak kaybetmesi demek.
 * Bu yüzden iddialar "uyarı ÜRETİLİR" yönünde yazıldı — sessiz kalmanın
 * maliyeti, gereksiz onay istemenin maliyetinden kat kat yüksek.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  dangerousChange,
  parseUfwStatus,
  parseUfwVerbose,
  type FirewallRule,
} from "./ufw.ts";

process.env.PANEL_HTTPS_PORT = "8443";
process.env.PANEL_HTTP_PORT = "8080";
process.env.PANEL_SUBNET = "172.28.0.0/16";
const NUMBERED = `Status: active

     To                         Action      From
     --                         ------      ----
[ 1] 22/tcp                     ALLOW IN    Anywhere
[ 2] 8443/tcp                   ALLOW IN    192.168.61.0/24            # panel yonetimi
[ 3] 3306/tcp                   DENY IN     Anywhere
[ 4] 22/tcp (v6)                ALLOW IN    Anywhere (v6)
`;

const VERBOSE = `Status: active
Logging: on (low)
Default: deny (incoming), allow (outgoing), disabled (routed)
New profiles: skip
`;

function state(rules: FirewallRule[]) {
  return {
    available: true,
    active: false,
    rules,
    defaults: null,
    logging: null,
    message: "",
    setupHint: null,
  };
}

describe("parseUfwStatus", () => {
  it("numaralı kuralları okur", () => {
    const parsed = parseUfwStatus(NUMBERED);
    assert.equal(parsed.active, true);
    assert.equal(parsed.rules.length, 4);
    assert.equal(parsed.rules[0].to, "22/tcp");
    assert.equal(parsed.rules[0].action, "ALLOW IN");
  });

  it("açıklamayı SÜTUN SANMAZ — ayrı alana koyar", () => {
    // Ayrılmazsa "# panel yonetimi" dördüncü sütun olur ve `from` bozulur.
    const rule = parseUfwStatus(NUMBERED).rules[1];
    assert.equal(rule.comment, "panel yonetimi");
    assert.equal(rule.from, "192.168.61.0/24");
  });

  it("açıklaması olmayan kuralda comment BOŞTUR", () => {
    assert.equal(parseUfwStatus(NUMBERED).rules[0].comment, "");
  });

  it("IPv6 satırındaki 'Anywhere (v6)' değerini bozmaz", () => {
    const rule = parseUfwStatus(NUMBERED).rules[3];
    assert.equal(rule.from, "Anywhere (v6)");
  });

  it("inactive durumunu active SANMAZ", () => {
    assert.equal(parseUfwStatus("Status: inactive\n").active, false);
  });
});

describe("parseUfwVerbose", () => {
  it("varsayılan politikaları üç yön için okur", () => {
    const parsed = parseUfwVerbose(VERBOSE);
    assert.deepEqual(parsed.defaults, {
      incoming: "deny",
      outgoing: "allow",
      routed: "disabled",
    });
  });

  it("log seviyesini okur", () => {
    assert.equal(parseUfwVerbose(VERBOSE).logging, "on (low)");
  });

  it("Default satırı yoksa BİLİNMİYOR döner — deny VARSAYMAZ", () => {
    // Bilinmeyeni "deny" saymak, açık bir sunucuyu korunuyor gibi gösterirdi.
    assert.equal(parseUfwVerbose("Status: active\n").defaults, null);
  });
});

describe("dangerousChange — enable", () => {
  it("SSH kuralı YOKKEN uyarır", () => {
    const warning = dangerousChange({ kind: "enable" }, state([]));
    assert.match(warning ?? "", /SSH \(22\)/);
  });

  it("panel portu kuralı YOKKEN uyarır ve portu ADIYLA söyler", () => {
    const rules = parseUfwStatus("[ 1] 22/tcp   ALLOW IN    Anywhere\n").rules;
    const warning = dangerousChange({ kind: "enable" }, state(rules));
    assert.match(warning ?? "", /8443/);
  });

  it("SSH kuralı DENY ise izin sayılmaz", () => {
    const rules = parseUfwStatus("[ 1] 22/tcp   DENY IN     Anywhere\n").rules;
    assert.match(dangerousChange({ kind: "enable" }, state(rules)) ?? "", /SSH/);
  });

  it("OpenSSH uygulama profilini SSH kuralı sayar", () => {
    const rules = parseUfwStatus(
      "[ 1] OpenSSH    ALLOW IN    Anywhere\n[ 2] 8443/tcp   ALLOW IN    Anywhere\n[ 3] 8080/tcp   ALLOW IN    Anywhere\n",
    ).rules;
    const warning = dangerousChange({ kind: "enable" }, state(rules));
    // SSH/panel uyarısı gitmeli; kalan uyarı yalnızca Docker alt ağı olabilir.
    assert.doesNotMatch(warning ?? "", /SSH \(22\)/);
  });

  it("SSH, panel portları ve Docker alt ağı varken uyarı YOKTUR", () => {
    const rules = parseUfwStatus(
      "[ 1] 22/tcp     ALLOW IN    Anywhere\n" +
        "[ 2] 8443/tcp   ALLOW IN    Anywhere\n" +
        "[ 3] 8080/tcp   ALLOW IN    Anywhere\n" +
        "[ 4] Anywhere   ALLOW IN    172.28.0.0/16\n",
    ).rules;
    assert.equal(dangerousChange({ kind: "enable" }, state(rules)), null);
  });

  it("port eşlemesi PARÇA EŞLEŞMEZ — 8443 kuralı 443'ü karşılamaz", () => {
    const rules = parseUfwStatus(
      "[ 1] 22/tcp     ALLOW IN    Anywhere\n[ 2] 18443/tcp  ALLOW IN    Anywhere\n",
    ).rules;
    assert.match(dangerousChange({ kind: "enable" }, state(rules)) ?? "", /8443/);
  });
});

describe("dangerousChange — kural", () => {
  it("panel portunu kapatan deny kuralında uyarır", () => {
    const warning = dangerousChange(
      { kind: "rule", rule: "8443/tcp", action: "deny" },
      state([]),
    );
    assert.match(warning ?? "", /8443/);
  });

  it("SSH'ı kapatan deny kuralında uyarır", () => {
    const warning = dangerousChange({ kind: "rule", rule: "22", action: "deny" }, state([]));
    assert.match(warning ?? "", /SSH/);
  });

  it("'from ... to any port 22' biçimindeki denyi de yakalar", () => {
    const warning = dangerousChange(
      { kind: "rule", rule: "from 10.0.0.1 to any port 22", action: "deny" },
      state([]),
    );
    assert.match(warning ?? "", /SSH/);
  });

  it("allow kuralı hiçbir zaman uyarı üretmez", () => {
    assert.equal(
      dangerousChange({ kind: "rule", rule: "8443/tcp", action: "allow" }, state([])),
      null,
    );
  });

  it("ilgisiz bir portun deny'ında uyarı yoktur", () => {
    assert.equal(
      dangerousChange({ kind: "rule", rule: "3306/tcp", action: "deny" }, state([])),
      null,
    );
  });
});

describe("dangerousChange — varsayılan politika", () => {
  it("gelen trafiği 'allow' yapmayı uyarır", () => {
    const warning = dangerousChange(
      { kind: "default", policy: "allow", direction: "incoming" },
      state([]),
    );
    assert.match(warning ?? "", /HER portu/);
  });

  it("giden trafiği kısıtlamayı uyarır", () => {
    const warning = dangerousChange(
      { kind: "default", policy: "deny", direction: "outgoing" },
      state([]),
    );
    assert.match(warning ?? "", /[Gg]iden/);
  });

  it("gelen trafiği 'deny' yapmak olağan — uyarı yok", () => {
    assert.equal(
      dangerousChange({ kind: "default", policy: "deny", direction: "incoming" }, state([])),
      null,
    );
  });
});
