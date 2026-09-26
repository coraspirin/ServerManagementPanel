import assert from "node:assert/strict";
import { test } from "node:test";

import {
  UPDATER_SCRIPT,
  compareTags,
  formatStateLine,
  isReleaseTag,
  isRepoName,
  parseStateLine,
  pickLatestTag,
  releaseImageRef,
} from "./plan.ts";

test("yalnızca vX.Y.Z yayın etiketi kabul edilir", () => {
  assert.equal(isReleaseTag("v1.10.0"), true);
  assert.equal(isReleaseTag("1.10.0"), false);
  assert.equal(isReleaseTag("v1.10.0-rc1"), false);
  assert.equal(isReleaseTag("v1.10"), false);
  assert.equal(isReleaseTag("v1.10.0; rm -rf /"), false);
});

test("depo adı sahip/depo biçiminde olmalı", () => {
  assert.equal(isRepoName("coraspirin/ServerManagementPanel"), true);
  assert.equal(isRepoName("coraspirin"), false);
  assert.equal(isRepoName("a/b/c"), false);
  assert.equal(isRepoName("a/b?x=1"), false);
});

test("en yeni etiket sayısal karşılaştırmayla seçilir", () => {
  assert.equal(pickLatestTag(["v1.9.0", "v1.10.0", "v1.2.3", "1.0", "latest"]), "v1.10.0");
  assert.equal(pickLatestTag(["v2.0.0-rc1", "v1.0.0"]), "v1.0.0");
  assert.equal(pickLatestTag(["main"]), null);
});

test("etiket karşılaştırması baştaki v'yi yok sayar", () => {
  assert.ok(compareTags("v1.10.0", "1.9.0") > 0);
  assert.equal(compareTags("v1.10.0", "1.10.0"), 0);
  assert.ok(compareTags("v1.9.9", "1.10.0") < 0);
});

test("durum satırı gidiş-dönüş", () => {
  const line = formatStateLine(1700000000, "failed", "v1.10.0", "copy src");
  assert.deepEqual(parseStateLine(line), {
    at: 1700000000,
    phase: "failed",
    tag: "v1.10.0",
    detail: "copy src",
  });
  assert.deepEqual(parseStateLine("1700000000 done v1.10.0 \n"), {
    at: 1700000000,
    phase: "done",
    tag: "v1.10.0",
    detail: null,
  });
});

test("bozuk durum dosyası boşta sayılır", () => {
  assert.equal(parseStateLine("").phase, "idle");
  assert.equal(parseStateLine("abc running v1").phase, "idle");
  assert.equal(parseStateLine("1 exploded v1").phase, "idle");
});

test("betikte JS tarafından yorumlanacak kalıntı yok", () => {
  // String.raw içindeki `\${` ters eğik çizgiyi çıktıda bırakır; kabuk
  // değişkenleri `${…}` olmadan yazılmalı.
  assert.equal(UPDATER_SCRIPT.includes("${"), false);
  assert.equal(UPDATER_SCRIPT.includes("\\$"), false);
  assert.match(UPDATER_SCRIPT, /printf '%s %s %s %s\\n'/);
});

test("sunucuya özel dosyalar betikte korunuyor", () => {
  for (const name of [".env|", "docker-compose*.yml", "Caddyfile", ".panel-backups)"]) {
    assert.ok(UPDATER_SCRIPT.includes(name), name);
  }
});

test("imajla kurulumda yeni sürümün imaj referansı", () => {
  assert.equal(releaseImageRef("ghcr.io/sahip/panel:1.11.1", "v1.12.0"), "ghcr.io/sahip/panel:1.12.0");
  assert.equal(releaseImageRef("ghcr.io/sahip/panel:latest", "v1.12.0"), "ghcr.io/sahip/panel:1.12.0");
  assert.equal(releaseImageRef("localhost:5000/panel", "v2.0.0"), "localhost:5000/panel:2.0.0");
  assert.equal(releaseImageRef("ghcr.io/sahip/panel@sha256:abc", "v1.0.1"), "ghcr.io/sahip/panel:1.0.1");
  assert.equal(releaseImageRef("server-panel:local", "v1.12.0"), null);
});
