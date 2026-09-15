/**
 * Yığın listesinin sözleşme testleri (M3.37).
 *
 * En kritik iddia CONTAINER'I OLMAYAN KAYIT LİSTEDE KALIR: kurulumu başarısız
 * olan bir yığının container'ı yoktur ve yalnızca etiket keşfine dayanan bir
 * liste onu hiç göstermez. Passbolt olayında yaşanan çıkmaz tam olarak buydu —
 * kullanıcının "Tekrar dene" diyebilmesi bu satırın var olmasına bağlı.
 *
 * İkincisi SAYILAR SÜZGEÇTEN ETKİLENMEZ: "2/3 çalışıyor" arama kutusuna göre
 * değişirse panel yalan söyler.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildStacks, type StackContainer, type StackRecord } from "./stacks.ts";

function con(over: Partial<StackContainer> = {}): StackContainer {
  return {
    id: "id-" + (over.name ?? "x"),
    name: "web",
    state: "running",
    composeProject: "proje",
    composeService: "web",
    cpuPct: 1,
    memUsed: 100,
    labels: { "com.docker.compose.project.working_dir": "/opt/stacks/proje" },
    ...over,
  };
}

function kayit(over: Partial<StackRecord> = {}): StackRecord {
  return { name: "proje", directory: "/opt/stacks/proje", lastAction: "up", lastError: "", ...over };
}

describe("buildStacks — keşif", () => {
  it("container'ları projesine göre toplar", () => {
    const rows = buildStacks(
      [con({ name: "a" }), con({ name: "b" }), con({ name: "c", composeProject: "diger" })],
      [],
    );
    assert.equal(rows.length, 2);
    assert.equal(rows.find((r) => r.name === "proje")?.total, 2);
  });

  it("compose projesi OLMAYAN container'ı atlar", () => {
    // Yığın listesi yığınları gösterir; başıboş container'ların yeri
    // Container sekmesi.
    assert.deepEqual(buildStacks([con({ composeProject: null })], []), []);
  });

  it("çalışan sayısını ayrı sayar", () => {
    const rows = buildStacks(
      [con({ name: "a" }), con({ name: "b", state: "exited" })],
      [],
    );
    assert.equal(rows[0].total, 2);
    assert.equal(rows[0].running, 1);
  });

  it("CPU ve belleği TOPLAR", () => {
    const rows = buildStacks([con({ name: "a" }), con({ name: "b", cpuPct: 2, memUsed: 50 })], []);
    assert.equal(rows[0].cpuPct, 3);
    assert.equal(rows[0].memUsed, 150);
  });

  it("ölçümü olmayan üye toplamı SIFIRLAMAZ", () => {
    // Yeni başlamış bir container'ın ölçümü henüz yok; toplamı null yapmak
    // yığının tamamını ölçümsüz gösterirdi.
    const rows = buildStacks([con({ name: "a" }), con({ name: "b", cpuPct: null, memUsed: null })], []);
    assert.equal(rows[0].cpuPct, 1);
    assert.equal(rows[0].memUsed, 100);
  });

  it("çalışma dizinini etiketten okur", () => {
    assert.equal(buildStacks([con()], [])[0].workingDir, "/opt/stacks/proje");
  });

  it("çalışma dizini etiketi YOKSA null bırakır — compose işlemleri kapalı", () => {
    assert.equal(buildStacks([con({ labels: {} })], [])[0].workingDir, null);
  });

  it("compose dosyalarını virgülden ayırır", () => {
    const rows = buildStacks(
      [con({ labels: { "com.docker.compose.project.config_files": "/a/x.yml, /a/y.yml" } })],
      [],
    );
    assert.deepEqual(rows[0].configFiles, ["/a/x.yml", "/a/y.yml"]);
  });

  it("keşfedilen yığını DIŞ olarak işaretler", () => {
    assert.equal(buildStacks([con()], [])[0].source, "dis");
  });
});

describe("buildStacks — panel kaydıyla birleşme", () => {
  it("CONTAINER'I OLMAYAN kaydı listede TUTAR", () => {
    // Kurulumu başarısız yığının container'ı yoktur; kayıt olmasa kullanıcı
    // onu ne görebilir ne de tekrar deneyebilirdi.
    const rows = buildStacks([], [kayit({ lastAction: "geçersiz compose", lastError: "port dolu" })]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].total, 0);
    assert.equal(rows[0].lastError, "port dolu");
  });

  it("aynı adı ADA GÖRE birleştirir, ikinci satır üretmez", () => {
    const rows = buildStacks([con({ name: "a" })], [kayit()]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].total, 1);
    assert.equal(rows[0].source, "panel");
  });

  it("panel kaydı olanı PANEL olarak işaretler", () => {
    assert.equal(buildStacks([con()], [kayit()])[0].source, "panel");
  });

  it("etiket dizini KAYDIN dizinini ezer", () => {
    // Çalışan container'ın etiketi güncel gerçeği söyler.
    const rows = buildStacks([con()], [kayit({ directory: "/eski/yer" })]);
    assert.equal(rows[0].workingDir, "/opt/stacks/proje");
  });

  it("etiket yoksa KAYDIN dizinine düşer", () => {
    // Tamamen durmuş yığında etiket taşıyan container kalmamış olabilir.
    const rows = buildStacks([], [kayit({ directory: "/opt/stacks/proje" })]);
    assert.equal(rows[0].workingDir, "/opt/stacks/proje");
  });
});

describe("buildStacks — sıralama ve dayanıklılık", () => {
  it("ada göre sıralar", () => {
    const rows = buildStacks(
      [con({ name: "a", composeProject: "zeta" }), con({ name: "b", composeProject: "alfa" })],
      [],
    );
    assert.deepEqual(rows.map((r) => r.name), ["alfa", "zeta"]);
  });

  it("boş girdide boş liste döner", () => {
    assert.deepEqual(buildStacks([], []), []);
  });

  it("etiketi null olan container'da ÇÖKMEZ", () => {
    const rows = buildStacks([con({ labels: null })], []);
    assert.equal(rows[0].workingDir, null);
  });
});
