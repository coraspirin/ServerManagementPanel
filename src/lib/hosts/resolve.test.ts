import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickHost, type HostCandidate } from "./resolve.ts";

const HOSTS: HostCandidate[] = [
  { id: 1, name: "local", enabled: true },
  { id: 2, name: "web-01", enabled: true },
  { id: 3, name: "yedek", enabled: false },
];

describe("pickHost", () => {
  it("hiçbir şey yoksa yerel sunucu", () => {
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

  it("çerez silinmiş/devre dışı sunucuyu gösteriyorsa sessizce yerele düşer", () => {
    assert.deepEqual(pickHost({ cookie: "99" }, HOSTS), { ok: true, hostId: 1, explicit: false });
    assert.deepEqual(pickHost({ cookie: "3" }, HOSTS), { ok: true, hostId: 1, explicit: false });
  });
});
