import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultHostId, pickHost, type HostCandidate } from "./resolve.ts";

const HOSTS: HostCandidate[] = [
  { id: 1, name: "local", enabled: true },
  { id: 2, name: "web-01", enabled: true },
  { id: 3, name: "yedek", enabled: false },
];

describe("pickHost", () => {
  it("hiçbir şey yoksa varsayılan (yerel etkinse yerel)", () => {
    assert.deepEqual(pickHost({}, HOSTS), { ok: true, hostId: 1, explicit: false });
  });

  it("başlık sorguyu ve çerezi ezer", () => {
    assert.deepEqual(pickHost({ header: "2", query: "1", cookie: "1" }, HOSTS), {
      ok: true,
      hostId: 2,
      explicit: true,
    });
  });

  it("sorgu çerezi ezer ve açık sayılır", () => {
    assert.deepEqual(pickHost({ query: "web-01", cookie: "1" }, HOSTS), {
      ok: true,
      hostId: 2,
      explicit: true,
    });
  });

  it("çerez açık seçim sayılmaz", () => {
    assert.deepEqual(pickHost({ cookie: "2" }, HOSTS), { ok: true, hostId: 2, explicit: false });
  });

  it("açık istekte bilinmeyen sunucu hatadır", () => {
    assert.deepEqual(pickHost({ header: "99" }, HOSTS), { ok: false, reason: "unknown", value: "99" });
  });

  it("açık istekte devre dışı sunucu hatadır", () => {
    assert.deepEqual(pickHost({ query: "3" }, HOSTS), { ok: false, reason: "disabled", value: "3" });
  });

  it("çerez silinmiş/devre dışı sunucuyu gösteriyorsa varsayılana düşer", () => {
    assert.deepEqual(pickHost({ cookie: "99" }, HOSTS), { ok: true, hostId: 1, explicit: false });
    assert.deepEqual(pickHost({ cookie: "3" }, HOSTS), { ok: true, hostId: 1, explicit: false });
  });
});

describe("yerel devre dışı (D1)", () => {
  const NO_LOCAL: HostCandidate[] = [
    { id: 1, name: "local", enabled: false },
    { id: 2, name: "web-01", enabled: true },
    { id: 3, name: "yedek", enabled: false },
  ];
  const NONE: HostCandidate[] = [{ id: 1, name: "local", enabled: false }];

  it("varsayılan ilk etkin sunucu, yerele düşülmez", () => {
    assert.equal(defaultHostId(NO_LOCAL), 2);
    assert.deepEqual(pickHost({}, NO_LOCAL), { ok: true, hostId: 2, explicit: false });
    assert.deepEqual(pickHost({ cookie: "1" }, NO_LOCAL), { ok: true, hostId: 2, explicit: false });
  });

  it("yerel açıkça istenirse devre dışı hatası", () => {
    assert.deepEqual(pickHost({ header: "1" }, NO_LOCAL), { ok: false, reason: "disabled", value: "1" });
  });

  it("etkin sunucu yoksa none", () => {
    assert.equal(defaultHostId(NONE), null);
    assert.equal(defaultHostId([]), null);
    assert.deepEqual(pickHost({}, NONE), { ok: false, reason: "none" });
    assert.deepEqual(pickHost({ cookie: "1" }, NONE), { ok: false, reason: "none" });
  });
});
