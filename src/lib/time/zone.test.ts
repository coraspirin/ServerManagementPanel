/**
 * Saat dilimi sözleşmesi (2026-10-14).
 *
 * Asıl iddia: cron önizlemesi (istemci, `nextRuns`) ile zamanlayıcı (sunucu,
 * `cron-parser`) AYNI anı bulur — ikisi de panelin saat dilimine bakar,
 * tarayıcının ya da sürecin yereline değil. Yedek ekranında "Genel bakış
 * 09:00, sekmeler 06:00" ayrışması tam olarak bu ikisinin farklı dilimde
 * çalışmasıydı.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CronExpressionParser } from "cron-parser";

import { nextRuns } from "../cron/friendly.ts";
import { formatDateTime, formatTime } from "../i18n/format.ts";
import { localeDictionary } from "../../locales/index.ts";
import { fromWallClock, isValidTimeZone, supportedTimeZones, wallClock } from "./zone.ts";

const tr = localeDictionary("tr");
const IST = "Europe/Istanbul";
const BERLIN = "Europe/Berlin";

describe("isValidTimeZone", () => {
  it("IANA adlarını ve UTC'yi kabul eder", () => {
    assert.equal(isValidTimeZone(IST), true);
    assert.equal(isValidTimeZone("UTC"), true);
  });
  it("uydurma adı, boş metni ve metin olmayanı reddeder", () => {
    assert.equal(isValidTimeZone("Mars/Olympus"), false);
    assert.equal(isValidTimeZone(""), false);
    assert.equal(isValidTimeZone(3), false);
  });
  it("seçici listesinde UTC ve İstanbul var", () => {
    const zones = supportedTimeZones();
    assert.ok(zones.includes("UTC"));
    assert.ok(zones.includes(IST));
  });
});

describe("wallClock / fromWallClock", () => {
  it("İstanbul UTC+3: 03:00Z → duvar saati 06:00", () => {
    const wall = wallClock(new Date("2026-10-14T03:00:00Z"), IST);
    assert.equal(wall.getUTCHours(), 6);
    assert.equal(fromWallClock(wall, IST).toISOString(), "2026-10-14T03:00:00.000Z");
  });
  it("yaz saati sınırında gidiş-dönüş tutarlı (Berlin, 2026-10-25)", () => {
    for (const iso of ["2026-10-24T22:30:00Z", "2026-10-25T02:30:00Z", "2026-03-29T03:30:00Z"]) {
      const instant = new Date(iso);
      assert.equal(fromWallClock(wallClock(instant, BERLIN), BERLIN).toISOString(), instant.toISOString());
    }
  });
});

describe("nextRuns — panel saat diliminde", () => {
  const from = new Date("2026-10-14T00:00:00Z");

  it("'0 6 * * *' İstanbul'da 03:00Z'dir (eskiden sunucu 06:00Z hesaplıyordu)", () => {
    const [first] = nextRuns("0 6 * * *", 1, from, IST);
    assert.equal(first.toISOString(), "2026-10-14T03:00:00.000Z");
  });

  it("istemci önizlemesi ile sunucu zamanlayıcısı aynı anları bulur", () => {
    for (const [expr, zone] of [
      ["0 6 * * *", IST],
      ["30 2 * * 0", BERLIN],
      ["*/15 * * * *", IST],
      ["0 0 1 * *", "America/New_York"],
      ["0 3 * * 1-5", "UTC"],
    ] as const) {
      const client = nextRuns(expr, 3, from, zone).map((date) => date.toISOString());
      const interval = CronExpressionParser.parse(expr, { currentDate: from, tz: zone });
      const server = [0, 1, 2].map(() => new Date(interval.next().getTime()).toISOString());
      assert.deepEqual(client, server, `${expr} @ ${zone}`);
    }
  });
});

describe("biçimleme panel saat dilimiyle", () => {
  const instant = new Date("2026-10-14T03:00:00Z");
  it("timeZone verilince tarayıcı/süreç diliminden bağımsız", () => {
    assert.equal(formatTime(instant, tr, undefined, IST), "06:00");
    assert.equal(formatTime(instant, tr, undefined, "UTC"), "03:00");
  });
  it("çağıranın kendi timeZone'u kazanır", () => {
    assert.equal(formatTime(instant, tr, { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }, IST), "03:00");
  });
  it("seçeneksiz formatDateTime tarih + saat basar", () => {
    assert.match(formatDateTime(instant, tr, undefined, IST), /06:00/);
  });
});
