import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { REDACTED, redactHeaders, redactText, tokenAuditTag } from "./redact.ts";

describe("redactHeaders", () => {
  it("Authorization başlığını gizler", () => {
    const safe = redactHeaders(new Headers({ authorization: "Bearer pnl_gizli_deger" }));
    assert.equal(safe.authorization, REDACTED);
    assert.ok(!JSON.stringify(safe).includes("pnl_gizli_deger"));
  });

  it("büyük harfli yazımı da yakalar", () => {
    // Headers zaten küçük harfe indiriyor ama karşılaştırma buna
    // güvenmemeli: bir gün düz nesne geçirilirse kural bozulmamalı.
    const safe = redactHeaders(new Headers({ Authorization: "Bearer pnl_x", Cookie: "a=b" }));
    assert.equal(safe.authorization, REDACTED);
    assert.equal(safe.cookie, REDACTED);
  });

  it("CSRF başlığını da gizler", () => {
    const safe = redactHeaders(new Headers({ "x-csrf-token": "abc123" }));
    assert.equal(safe["x-csrf-token"], REDACTED);
  });

  it("zararsız başlıkları olduğu gibi bırakır", () => {
    const safe = redactHeaders(new Headers({ "content-type": "application/json", accept: "*/*" }));
    assert.equal(safe["content-type"], "application/json");
    assert.equal(safe.accept, "*/*");
  });
});

describe("redactText", () => {
  it("serbest metindeki anahtarı temizler", () => {
    const text = "istek başarısız: pnl_AbCdEf0123456789xyz geçersiz";
    assert.ok(!redactText(text).includes("pnl_AbCdEf0123456789xyz"));
    assert.ok(redactText(text).includes(REDACTED));
  });

  it("anahtar olmayan metne dokunmaz", () => {
    assert.equal(redactText("container yeniden başlatıldı"), "container yeniden başlatıldı");
  });
});

describe("tokenAuditTag", () => {
  it("adı ve öneki yazar, değeri asla", () => {
    const tag = tokenAuditTag("grafana", "pnl_a1b2c3d4");
    assert.equal(tag, "[token:grafana prefix:pnl_a1b2c3d4]");
  });
});
