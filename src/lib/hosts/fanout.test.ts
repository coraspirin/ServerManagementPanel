import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { currentHostId } from "./context.ts";
import { fanOut, summarizeOutcomes } from "./fanout.ts";

const HOSTS = [
  { id: 1, name: "local" },
  { id: 2, name: "web" },
  { id: 3, name: "db" },
];

describe("fanOut", () => {
  it("her sunucu kendi bağlamında çalışır", async () => {
    const outcomes = await fanOut(HOSTS, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return currentHostId();
    });
    assert.deepEqual(
      outcomes.map((outcome) => (outcome.ok ? outcome.value : null)),
      [1, 2, 3],
    );
  });

  it("bir sunucunun hatası diğerlerini durdurmaz", async () => {
    const outcomes = await fanOut(HOSTS, async (host) => {
      if (host.id === 2) throw new Error("ulaşılamıyor");
      return "ok";
    });
    assert.deepEqual(
      outcomes.map((outcome) => outcome.ok),
      [true, false, true],
    );
  });

  it("eşzamanlılık sınırına uyar", async () => {
    let active = 0;
    let peak = 0;
    const many = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `h${i}` }));
    await fanOut(
      many,
      async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active--;
      },
      3,
    );
    assert.equal(peak, 3);
  });
});

describe("summarizeOutcomes", () => {
  it("tek sunucuda metin aynen döner, hata fırlatılır", () => {
    assert.equal(summarizeOutcomes([{ host: HOSTS[0], ok: true, value: "12 örnek" }]), "12 örnek");
    assert.throws(() => summarizeOutcomes([{ host: HOSTS[0], ok: false, error: "x" }]), /x/);
  });

  it("birden fazla sunucuda kısmi hata işi düşürmez", () => {
    const text = summarizeOutcomes([
      { host: HOSTS[0], ok: true, value: "12" },
      { host: HOSTS[1], ok: false, error: "kapalı" },
    ]);
    assert.equal(text, "local: 12 · web: ✖ kapalı");
  });

  it("hepsi başarısızsa iş başarısız", () => {
    assert.throws(() =>
      summarizeOutcomes([
        { host: HOSTS[0], ok: false, error: "a" },
        { host: HOSTS[1], ok: false, error: "b" },
      ]),
    );
  });
});
