/**
 * Biçimleme sözleşmesi.
 *
 * En kritik iddia TÜRKÇE ÇIKTI DEĞİŞMEDİ: bu yardımcılar panelde elle yazılmış
 * "tr-TR" çağrılarının yerine geçiyor ve dil Türkçe kaldığında ekranın bir
 * pikseli bile oynamamalı.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  compareText,
  formatDuration,
  formatPct,
  formatRelative,
  formatUptime,
  formatWeekday,
} from "./format.ts";
import { localeDictionary } from "../../locales/index.ts";

const tr = localeDictionary("tr");
const en = localeDictionary("en");

describe("formatPct", () => {
  it("kalıp dil dosyasından: Türkçede işaret önde, İngilizcede arkada", () => {
    assert.equal(formatPct(42.5, tr), "%42.5");
    assert.equal(formatPct(42.5, en), "42.5%");
  });

  it("ondalık ayırıcı nokta kalır (Intl virgül üretirdi)", () => {
    assert.ok(formatPct(7.25, tr, 2).includes("."));
  });

  it("sayı değilse tire", () => {
    assert.equal(formatPct(Number.NaN, tr), "—");
  });
});

describe("formatDuration", () => {
  it("eski Türkçe biçimi birebir korur", () => {
    assert.equal(formatDuration(2 * 86400 + 3 * 3600, tr), "2 gün 3 saat");
    assert.equal(formatDuration(3 * 3600 + 5 * 60, tr), "3 saat 5 dk");
    assert.equal(formatDuration(5 * 60, tr), "5 dk");
  });

  it("İngilizcede çoğul doğru", () => {
    assert.equal(formatDuration(86400 + 3600, en), "1 day 1 hour");
    assert.equal(formatDuration(2 * 86400 + 3 * 3600, en), "2 days 3 hours");
  });

  it("negatif ve sonsuz değerde tire", () => {
    assert.equal(formatDuration(-1, tr), "—");
    assert.equal(formatDuration(Number.POSITIVE_INFINITY, tr), "—");
  });
});

describe("formatUptime", () => {
  it("bir dakikanın altında saniye gösterir", () => {
    assert.equal(formatUptime(45, tr), "45 sn");
    assert.equal(formatUptime(45, en), "45s");
  });
});

describe("formatRelative", () => {
  it("az önce", () => {
    assert.equal(formatRelative(Date.now() - 5_000, tr), "az önce");
    assert.equal(formatRelative(Date.now() - 5_000, en), "just now");
  });

  it("dakika ve saat", () => {
    assert.equal(formatRelative(Date.now() - 5 * 60_000, tr), "5 dk önce");
    assert.equal(formatRelative(Date.now() - 3 * 3_600_000, en), "3h ago");
  });

  it("gelecekteki damgayı 'az önce' sayar", () => {
    assert.equal(formatRelative(Date.now() + 60_000, tr), "az önce");
  });

  it("geçersiz girdide tire", () => {
    assert.equal(formatRelative("olmayan tarih", tr), "—");
  });
});

describe("compareText", () => {
  it("Türkçe alfabeye göre sıralar", () => {
    const words = ["zebra", "çilek", "armut", "ıhlamur"];
    const sorted = [...words].sort((a, b) => compareText(a, b, tr));
    assert.deepEqual(sorted, ["armut", "çilek", "ıhlamur", "zebra"]);
  });
});

describe("formatWeekday", () => {
  it("0'ı Pazar sayar, dile göre ad verir", () => {
    assert.equal(formatWeekday(0, tr), "Pazar");
    assert.equal(formatWeekday(1, en), "Monday");
    assert.equal(formatWeekday(6, en, "short"), "Sat");
  });
});
