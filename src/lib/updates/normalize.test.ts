/**
 * Önbellek şeması tamamlamasının regresyon testleri (M3.35).
 *
 * Bu testler YAŞANMIŞ bir çökmeyi kilitliyor: M3.29 dağıtıldığında bakım
 * sayfası `TypeError: Cannot read properties of undefined (reading 'tag')` ile
 * komple açılmadı. Sebep, diskteki önbelleğin panelin ESKİ sürümü tarafından
 * yazılmış olması ve yeni alanları taşımamasıydı.
 *
 * En kritik iddia EKSİK ALAN null'a DÖNÜŞÜR: `undefined !== null` doğru olduğu
 * için, eksik bir alan "değeri var" gibi davranıp süzgeçleri geçiyor.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { normalizeUpdate } from "./normalize.ts";

describe("normalizeUpdate", () => {
  it("EKSİK newerTag'i null yapar — `!== null` süzgeci onu elesin", () => {
    // Sayfayı çökerten tam olarak buydu: alan yoktu, süzgeç geçti, `.tag`
    // okunmaya çalışıldı.
    const satir = normalizeUpdate({});
    assert.equal(satir.newerTag, null);
    assert.ok(satir.newerTag === null, "süzgeç bu satırı elemeli");
  });

  it("EKSİK updatable'ı TRUE sayar — M3.27 öncesi davranış", () => {
    // "Güncellenemez" saymak, kullanıcıya var olmayan bir kısıt göstermek
    // olurdu. Emniyet kilidi zaten sunucu tarafında.
    assert.equal(normalizeUpdate({}).updatable, true);
  });

  it("EKSİK skipReason'ı null yapar", () => {
    assert.equal(normalizeUpdate({}).skipReason, null);
  });

  it("VAR OLAN değerlere dokunmaz", () => {
    const satir = normalizeUpdate({
      updatable: false,
      skipReason: "panel.update=false",
      newerTag: { tag: "1.26", bump: "minor" },
    });
    assert.equal(satir.updatable, false);
    assert.equal(satir.skipReason, "panel.update=false");
    assert.deepEqual(satir.newerTag, { tag: "1.26", bump: "minor" });
  });

  it("updatable FALSE değerini true'ya çevirmez", () => {
    // `??` yerine `||` kullanılsaydı `false` sessizce `true` olurdu ve
    // güncellenmemesi gereken container listede güncellenebilir görünürdü.
    assert.equal(normalizeUpdate({ updatable: false }).updatable, false);
  });

  it("ŞEMANIN geri kalanını olduğu gibi taşır", () => {
    const satir = normalizeUpdate({ container: "web", image: "nginx:1.24" } as never) as unknown as {
      container: string;
      image: string;
    };
    assert.equal(satir.container, "web");
    assert.equal(satir.image, "nginx:1.24");
  });
});
