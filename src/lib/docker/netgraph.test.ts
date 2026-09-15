/**
 * Ağ topolojisi modelinin sözleşme testleri (M3.25).
 *
 * En kritik iddia HİÇBİR AĞDA OLMAYAN CONTAINER GÖRÜNÜR: passbolt olayında
 * container tam olarak bu durumdaydı (compose up port çakışmasında yarıda
 * kaldı, container ağsız kaldı) ve panelde bunu gösteren hiçbir ekran yoktu.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildNetworkGraph,
  sharesNetwork,
  type GraphContainer,
  type GraphNetwork,
} from "./netgraph.ts";

function ag(name: string, attached: string[], driver = "bridge"): GraphNetwork {
  return { name, driver, attached, composeProject: null };
}

function kap(
  name: string,
  networks: string[],
  networkMode = "bridge",
  state = "running",
): GraphContainer {
  return { name, state, networks, networkMode, composeProject: null };
}

describe("buildNetworkGraph", () => {
  it("container'ı ait olduğu ağın üyesi yapar", () => {
    const grafik = buildNetworkGraph([ag("arka", ["db"])], [kap("db", ["arka"])]);
    assert.equal(grafik.networks[0].members.length, 1);
    assert.equal(grafik.networks[0].members[0].name, "db");
  });

  it("HİÇBİR AĞDA olmayan container'ı 'yalniz' olarak ayırır", () => {
    const grafik = buildNetworkGraph([ag("arka", ["db"])], [kap("db", ["arka"]), kap("passbolt", [])]);

    const yalniz = grafik.loose.find((node) => node.name === "passbolt");
    assert.ok(yalniz, "ağsız container loose listesinde olmalı");
    assert.equal(yalniz.kind, "yalniz");
  });

  it("ağsız container'lar listenin BAŞINDA durur — sorunlu olan onlar", () => {
    const grafik = buildNetworkGraph(
      [],
      [kap("h", [], "host"), kap("yetim", []), kap("p", [], "container:abc")],
    );
    assert.equal(grafik.loose[0].name, "yetim");
  });

  it("host ağını 'host' olarak işaretler, yalnız SAYMAZ", () => {
    // host ağındaki container ağsız değil, aksine en az izole olanı.
    const grafik = buildNetworkGraph([], [kap("z2m", [], "host")]);
    assert.equal(grafik.loose[0].kind, "host");
  });

  it("ağ yığınını paylaşan container'ı 'paylasan' işaretler", () => {
    const grafik = buildNetworkGraph([], [kap("vpn-app", [], "container:gluetun")]);
    assert.equal(grafik.loose[0].kind, "paylasan");
  });

  it("iki ağa bağlı container İKİ AĞDA DA görünür ama tek düğümdür", () => {
    const grafik = buildNetworkGraph(
      [ag("on", ["proxy"]), ag("arka", ["proxy"])],
      [kap("proxy", ["on", "arka"])],
    );
    const bulunanlar = grafik.networks.flatMap((network) =>
      network.members.filter((member) => member.name === "proxy"),
    );
    assert.equal(bulunanlar.length, 2);
    assert.equal(bulunanlar[0], bulunanlar[1], "aynı düğüm nesnesi paylaşılmalı");
  });

  it("attached ile container listesi ayrışırsa BİRLEŞİM alınır", () => {
    // Önbellek tazeliği farkı: eksik göstermektense fazla göstermek yeğ.
    const grafik = buildNetworkGraph([ag("arka", ["eski"])], [kap("yeni", ["arka"])]);
    const adlar = grafik.networks[0].members.map((member) => member.name);
    assert.deepEqual(adlar.sort(), ["eski", "yeni"]);
  });

  it("kalabalık ağlar önce sıralanır", () => {
    const grafik = buildNetworkGraph(
      [ag("bos", []), ag("dolu", ["a", "b"])],
      [kap("a", ["dolu"]), kap("b", ["dolu"])],
    );
    assert.equal(grafik.networks[0].name, "dolu");
  });

  it("boş girdide PATLAMAZ", () => {
    const grafik = buildNetworkGraph([], []);
    assert.deepEqual(grafik.networks, []);
    assert.deepEqual(grafik.loose, []);
  });
});

describe("sharesNetwork", () => {
  const grafik = buildNetworkGraph(
    [ag("on", ["caddy", "web"]), ag("arka", ["web", "db"])],
    [kap("caddy", ["on"]), kap("web", ["on", "arka"]), kap("db", ["arka"])],
  );
  const dugum = (name: string) =>
    grafik.networks.flatMap((network) => network.members).find((member) => member.name === name)!;

  it("ortak ağı olanlar birbirini çözebilir", () => {
    assert.equal(sharesNetwork(dugum("caddy"), dugum("web")), true);
  });

  it("ortak ağı OLMAYANLAR çözemez", () => {
    // caddy → db: ortak ağ yok. Bu, 502'lerin en sık sebebi.
    assert.equal(sharesNetwork(dugum("caddy"), dugum("db")), false);
  });

  it("iki host container'ı aynı ağ yığınındadır", () => {
    const host = buildNetworkGraph([], [kap("a", [], "host"), kap("b", [], "host")]);
    assert.equal(sharesNetwork(host.loose[0], host.loose[1]), true);
  });
});
