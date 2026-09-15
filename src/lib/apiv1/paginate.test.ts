import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LIMITS,
  buildPage,
  clampedNumber,
  decodeCursor,
  encodeCursor,
  optionalTimestamp,
} from "./paginate.ts";

describe("cursor kodla/çöz", () => {
  it("gidiş-dönüş değeri korur", () => {
    const cursor = { ts: 1787872302, id: 4211 };
    assert.deepEqual(decodeCursor(encodeCursor(cursor)), cursor);
  });

  it("ts=0 ve id=0 da geçerli", () => {
    // Sıfır düşmemeli: `if (!ts)` gibi bir kontrol epoch başındaki bir kaydı
    // geçersiz sayardı.
    assert.deepEqual(decodeCursor(encodeCursor({ ts: 0, id: 0 })), { ts: 0, id: 0 });
  });

  it("opak: çıktı ham değeri sızdırmıyor", () => {
    assert.ok(!encodeCursor({ ts: 1787872302, id: 42 }).includes("1787872302"));
  });

  it("bozuk girdileri reddeder", () => {
    for (const bad of ["", "abc", "!!!", "MTIz", "eyJ0cyI6MX0"]) {
      assert.equal(decodeCursor(bad), null, `"${bad}" reddedilmeliydi`);
    }
  });

  it("negatif ve ondalık değerleri reddeder", () => {
    assert.equal(decodeCursor(Buffer.from("-5:3").toString("base64url")), null);
    assert.equal(decodeCursor(Buffer.from("1.5:3").toString("base64url")), null);
  });
});

describe("buildPage", () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ ts: 1000 - i, id: 100 - i }));
  const cursorOf = (row: { ts: number; id: number }) => row;

  it("limit kadar satır döner ve devamını bildirir", () => {
    const page = buildPage(rows, 5, cursorOf);
    assert.equal(page.items.length, 5);
    assert.equal(page.hasMore, true);
    assert.ok(page.nextCursor !== null);
    // İmleç SON DÖNEN satırı işaret etmeli, okunan fazladan satırı değil.
    assert.deepEqual(decodeCursor(page.nextCursor as string), { ts: 996, id: 96 });
  });

  it("son sayfada imleç vermez", () => {
    const page = buildPage(rows.slice(0, 3), 5, cursorOf);
    assert.equal(page.items.length, 3);
    assert.equal(page.hasMore, false);
    assert.equal(page.nextCursor, null);
  });

  it("tam limit kadar satırda devam yok", () => {
    // limit+1 okunduğu için 5 satır = "tam olarak bitti" demek.
    const page = buildPage(rows.slice(0, 5), 5, cursorOf);
    assert.equal(page.hasMore, false);
    assert.equal(page.nextCursor, null);
  });

  it("boş sonuçta çökmez", () => {
    const page = buildPage([], 5, cursorOf);
    assert.deepEqual(page, { items: [], nextCursor: null, hasMore: false });
  });
});

describe("clampedNumber", () => {
  it("tavanı aşan değeri SESSİZCE kırpar, hata vermez", () => {
    assert.equal(clampedNumber("99999", 100, 1, LIMITS.events.max), 500);
  });

  it("tabanın altını yükseltir", () => {
    assert.equal(clampedNumber("0", 100, 1, 500), 1);
    assert.equal(clampedNumber("-42", 100, 1, 500), 1);
  });

  it("yok/boş/anlamsız değerde varsayılana düşer", () => {
    assert.equal(clampedNumber(null, 100, 1, 500), 100);
    assert.equal(clampedNumber("", 100, 1, 500), 100);
    assert.equal(clampedNumber("abc", 100, 1, 500), 100);
    assert.equal(clampedNumber("Infinity", 100, 1, 500), 100);
  });

  it("geçerli değeri olduğu gibi bırakır", () => {
    assert.equal(clampedNumber("250", 100, 1, 500), 250);
  });
});

describe("optionalTimestamp", () => {
  it("sayıyı geçirir, geçersizi yok sayar", () => {
    assert.equal(optionalTimestamp("1787872302"), 1787872302);
    assert.equal(optionalTimestamp(null), undefined);
    assert.equal(optionalTimestamp(""), undefined);
    assert.equal(optionalTimestamp("dün"), undefined);
  });
});
