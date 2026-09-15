/**
 * Docker olay sınıflandırmasının sözleşme testleri (M3.32).
 *
 * En kritik iddia KASITLI DURDURMA BİLDİRİM ÜRETMEZ: panelin durdur düğmesine
 * basan kullanıcıya "container sonlandı" bildirimi göndermek, bildirimlere
 * güveni bitiren türden bir gürültü. İkincisi OOM'un HER ZAMAN bildirilmesi —
 * onu göremediğimiz için bu fazı yapıyoruz.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { classify, type DockerEventRaw } from "./eventmap.ts";

function olay(action: string, attrs: Record<string, string> = {}): DockerEventRaw {
  return {
    Type: "container",
    Action: action,
    time: 1_700_000_000,
    Actor: { ID: "abc123def456", Attributes: { name: "web", image: "nginx:1.24", ...attrs } },
  };
}

describe("classify — kapsam", () => {
  it("container olmayan olayları ATLAR", () => {
    // Akışta imaj çekme, ağ bağlama, volume yaratma da var; hepsini kaydetmek
    // olay listesini kullanılmaz hale getirirdi.
    assert.equal(classify({ Type: "image", Action: "pull" }), null);
  });

  it("ilgilenmediğimiz eylemi ATLAR", () => {
    assert.equal(classify(olay("exec_start")), null);
    assert.equal(classify(olay("attach")), null);
  });

  it("yaşam döngüsü eylemlerini tanır", () => {
    for (const action of ["create", "start", "stop", "die", "kill", "restart"]) {
      assert.ok(classify(olay(action)), `${action} tanınmadı`);
    }
  });

  it("eylemi olmayan olayda ÇÖKMEZ", () => {
    assert.equal(classify({ Type: "container" }), null);
  });
});

describe("classify — bildirim kararı", () => {
  it("OOM'u KRİTİK sayar ve bildirir", () => {
    const sonuc = classify(olay("oom"));
    assert.equal(sonuc?.severity, "critical");
    assert.equal(sonuc?.notify, true);
  });

  it("temiz çıkışı BİLDİRMEZ", () => {
    const sonuc = classify(olay("die", { exitCode: "0" }));
    assert.equal(sonuc?.notify, false);
    assert.equal(sonuc?.severity, "info");
  });

  it("SIGTERM çıkışını (143) bildirmez — `docker stop` bu", () => {
    // Durdur düğmesine basan kullanıcıya bildirim göndermek gürültü olurdu.
    assert.equal(classify(olay("die", { exitCode: "143" }))?.notify, false);
  });

  it("SIGKILL çıkışını (137) bildirmez — OOM'un kendi olayı var", () => {
    // OOM'da Docker AYRICA `oom` yolluyor; ikisini birden bildirmek aynı
    // arızayı iki kez telefona düşürürdü.
    assert.equal(classify(olay("die", { exitCode: "137" }))?.notify, false);
  });

  it("BEKLENMEDİK çıkışı bildirir", () => {
    const sonuc = classify(olay("die", { exitCode: "1" }));
    assert.equal(sonuc?.notify, true);
    assert.equal(sonuc?.severity, "warning");
    assert.match(sonuc?.detail ?? "", /çıkış kodu: 1/);
  });

  it("çıkış kodu YOKSA bildirmez", () => {
    // Bilinmeyeni "arıza" saymak, her belirsiz olayı alarma çevirirdi.
    assert.equal(classify(olay("die"))?.notify, false);
  });

  it("panel.notify=false BİLDİRİMİ kapatır, KAYDI değil", () => {
    const sonuc = classify(olay("oom", { "panel.notify": "false" }));
    assert.ok(sonuc, "olay yine de kaydedilmeli");
    assert.equal(sonuc.notify, false);
    assert.equal(sonuc.severity, "critical");
  });
});

describe("classify — sağlık durumu", () => {
  it("`health_status: unhealthy` biçimini ayrıştırır", () => {
    const sonuc = classify(olay("health_status: unhealthy"));
    assert.equal(sonuc?.action, "health_status");
    assert.equal(sonuc?.severity, "warning");
    assert.match(sonuc?.title ?? "", /unhealthy/);
  });

  it("sağlık düşüşü BİLDİRİM ÜRETMEZ — monitörlerin işi", () => {
    assert.equal(classify(olay("health_status: unhealthy"))?.notify, false);
  });

  it("sağlıklıya dönüşü bilgi sayar", () => {
    assert.equal(classify(olay("health_status: healthy"))?.severity, "info");
  });
});

describe("classify — içerik", () => {
  it("imaj ve yığını detaya yazar", () => {
    const sonuc = classify(olay("start", { "com.docker.compose.project": "passbolt" }));
    assert.match(sonuc?.detail ?? "", /nginx:1\.24/);
    assert.match(sonuc?.detail ?? "", /passbolt/);
  });

  it("adı olmayan container'da KISA KİMLİĞE düşer", () => {
    const ham = olay("die");
    delete ham.Actor?.Attributes?.name;
    assert.equal(classify(ham)?.containerName, "abc123def456");
  });

  it("olayın kendi zamanını kullanır", () => {
    assert.equal(classify(olay("start"))?.ts, 1_700_000_000);
  });

  it("gruplama anahtarı container ve eylemden oluşur", () => {
    assert.equal(classify(olay("start"))?.alertKey, "docker.start.web");
  });
});
