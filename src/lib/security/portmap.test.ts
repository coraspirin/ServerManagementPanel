/**
 * Port sahipliği ve boş port mantığının sözleşme testleri (M3.17).
 *
 * Buradaki iddialar, ekranda gösterilen cevabın DOĞRU olmasını koruyor:
 * "hangi port boş" sorusuna yanlış cevap vermek, kullanıcının o portu bir
 * container'a verip Docker'ın "port is already allocated" demesiyle sonuçlanır
 * — yani sessiz değil, gürültülü ama zaman kaybettiren bir hata.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildPortMap,
  dockerPublishedPorts,
  freePorts,
  parseCgroup,
  portConflicts,
  reservedByOthers,
  reservedPorts,
  resolveOwner,
  type ContainerFacts,
  type ListeningPort,
  type RawSocket,
} from "./portmap.ts";

const CID = "3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a";

function socket(over: Partial<RawSocket> = {}): RawSocket {
  return {
    protocol: "tcp",
    address: "0.0.0.0",
    port: 8080,
    pid: 1234,
    process: "node",
    cgroup: "",
    ...over,
  };
}

function container(over: Partial<ContainerFacts> = {}): ContainerFacts {
  return {
    id: CID,
    name: "pihole",
    state: "running",
    composeProject: "pihole",
    ports: [],
    ...over,
  };
}

describe("parseCgroup", () => {
  it("cgroup v2 docker scope'undan container id'yi çıkarır", () => {
    const result = parseCgroup(`0::/system.slice/docker-${CID}.scope`);
    assert.equal(result.containerId, CID.slice(0, 12));
    assert.equal(result.unit, "");
  });

  it("cgroup v1 /docker/<id> yolunu da tanır", () => {
    const result = parseCgroup(`12:pids:/docker/${CID} 11:cpu:/docker/${CID}`);
    assert.equal(result.containerId, CID.slice(0, 12));
  });

  it("docker scope'u system.slice ALTINDA olsa bile servis SANILMAZ", () => {
    // Bu ayrım kaybolursa her container "docker.service" gibi görünür.
    const result = parseCgroup(`0::/system.slice/docker-${CID}.scope`);
    assert.equal(result.unit, "");
    assert.notEqual(result.containerId, "");
  });

  it("systemd unit adını okur", () => {
    assert.equal(parseCgroup("0::/system.slice/ssh.service").unit, "ssh.service");
  });

  it("şablonlu unit adını (@) korur", () => {
    const result = parseCgroup("0::/system.slice/system-getty.slice/getty@tty1.service");
    assert.equal(result.unit, "getty@tty1.service");
  });

  it("kullanıcı oturumundan ne container ne unit çıkarır", () => {
    const result = parseCgroup("0::/user.slice/user-1000.slice/session-3.scope");
    assert.deepEqual(result, { containerId: "", unit: "" });
  });

  it("boş cgroup'ta patlamaz", () => {
    assert.deepEqual(parseCgroup(""), { containerId: "", unit: "" });
  });
});

describe("resolveOwner", () => {
  it("cgroup container'ı Docker listesindeki adla eşler", () => {
    const owner = resolveOwner(
      socket({ cgroup: `0::/system.slice/docker-${CID}.scope` }),
      [container()],
    );
    assert.equal(owner.kind, "container");
    assert.equal(owner.name, "pihole");
    assert.equal(owner.composeProject, "pihole");
  });

  it("network_mode host container'ı PORT YAYINLAMADAN da eşler", () => {
    // Asıl kazanç bu: yayınlanmış portu olmadığı için hostPort eşlemesi bunu
    // asla bulamazdı.
    const owner = resolveOwner(
      socket({ port: 53, cgroup: `0::/system.slice/docker-${CID}.scope` }),
      [container({ ports: [] })],
    );
    assert.equal(owner.name, "pihole");
  });

  it("docker-proxy'yi hostPort üzerinden gerçek container'a bağlar", () => {
    // docker-proxy'nin cgroup'u HOST tarafındadır; container id vermez.
    const owner = resolveOwner(
      socket({ process: "docker-proxy", port: 8080, cgroup: "0::/system.slice/docker.service" }),
      [container({ name: "caddy", ports: [{ hostPort: 8080, containerPort: 80, protocol: "tcp" }] })],
    );
    assert.equal(owner.kind, "container");
    assert.equal(owner.name, "caddy");
  });

  it("systemd servisini unit adıyla verir", () => {
    const owner = resolveOwner(
      socket({ port: 22, process: "sshd", cgroup: "0::/system.slice/ssh.service" }),
      [],
    );
    assert.equal(owner.kind, "service");
    assert.equal(owner.name, "ssh.service");
  });

  it("hiçbir şey tutmazsa süreç adına düşer — UYDURMAZ", () => {
    const owner = resolveOwner(socket({ process: "dnsmasq", cgroup: "" }), []);
    assert.equal(owner.kind, "process");
    assert.equal(owner.name, "dnsmasq");
  });

  it("cgroup container diyor ama liste boşsa BOŞ AD döner, uydurma yapmaz", () => {
    const owner = resolveOwner(socket({ cgroup: `0::/docker/${CID}` }), []);
    assert.equal(owner.kind, "container");
    assert.equal(owner.name, "");
    assert.equal(owner.containerId, CID.slice(0, 12));
  });
});

describe("buildPortMap", () => {
  it("wildcard ve loopback'i adresten türetir", () => {
    const rows = buildPortMap(
      [socket({ address: "127.0.0.1", port: 3000 }), socket({ address: "0.0.0.0", port: 80 })],
      [],
    );
    const local = rows.find((row) => row.port === 3000);
    const any = rows.find((row) => row.port === 80);
    assert.equal(local?.loopback, true);
    assert.equal(local?.wildcard, false);
    assert.equal(any?.wildcard, true);
  });

  it("IPv6 :: adresini wildcard sayar", () => {
    const rows = buildPortMap([socket({ protocol: "tcp6", address: "::", port: 443 })], []);
    assert.equal(rows[0].wildcard, true);
  });

  it("dışarı açık portları başa sıralar", () => {
    const rows = buildPortMap(
      [
        socket({ address: "127.0.0.1", port: 1 }),
        socket({ address: "0.0.0.0", port: 9999 }),
      ],
      [],
    );
    assert.equal(rows[0].port, 9999);
  });
});

describe("reservedPorts", () => {
  it("DURMUŞ container'ın portunu da rezerve sayar", () => {
    // Bu testin düşmesi demek, boş port bulucunun çakışacak bir port önermesi
    // demektir.
    const reserved = reservedPorts(
      [],
      [container({ name: "eski", state: "exited", ports: [{ hostPort: 8081, containerPort: 80, protocol: "tcp" }] })],
    );
    const entry = reserved.get(8081);
    assert.equal(entry?.[0].kind, "declared");
    assert.equal(entry?.[0].state, "exited");
  });

  it("çalışan container'ı iki kez saymaz — soketten zaten geliyor", () => {
    const running = container({
      name: "caddy",
      state: "running",
      ports: [{ hostPort: 8443, containerPort: 443, protocol: "tcp" }],
    });
    const reserved = reservedPorts(buildPortMap([socket({ port: 8443 })], [running]), [running]);
    assert.equal(reserved.get(8443)?.length, 1);
  });

  it("hostPort'u olmayan container portunu rezerve etmez", () => {
    const reserved = reservedPorts(
      [],
      [container({ state: "exited", ports: [{ hostPort: null, containerPort: 80, protocol: "tcp" }] })],
    );
    assert.equal(reserved.size, 0);
  });
});

describe("freePorts", () => {
  it("meşgul portları atlar", () => {
    const reserved = reservedPorts(
      buildPortMap([socket({ port: 8000 }), socket({ port: 8001 })], []),
      [],
    );
    assert.deepEqual(freePorts(reserved, 8000, 8010, 3), [8002, 8003, 8004]);
  });

  it("ters verilen aralıkta BOŞ LİSTE DÖNMEZ, uçları takas eder", () => {
    assert.deepEqual(freePorts(new Map(), 8005, 8000, 2), [8000, 8001]);
  });

  it("aralık tamamen doluysa boş döner", () => {
    const reserved = reservedPorts(buildPortMap([socket({ port: 9000 })], []), []);
    assert.deepEqual(freePorts(reserved, 9000, 9000, 5), []);
  });

  it("geçersiz port numaralarına taşmaz", () => {
    assert.deepEqual(freePorts(new Map(), 0, 2, 5), [1, 2]);
  });
});

describe("portConflicts", () => {
  it("aynı host portunu isteyen iki container'ı yakalar", () => {
    const conflicts = portConflicts(
      [],
      [
        container({ id: "a".repeat(64), name: "birinci", ports: [{ hostPort: 8080, containerPort: 80, protocol: "tcp" }] }),
        container({ id: "b".repeat(64), name: "ikinci", ports: [{ hostPort: 8080, containerPort: 80, protocol: "tcp" }] }),
      ],
    );
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].port, 8080);
  });

  it("durmuş container'ın portunu başkası tutuyorsa uyarır", () => {
    const conflicts = portConflicts(
      buildPortMap([socket({ port: 8080, process: "nginx" })], []),
      [container({ name: "eski", state: "exited", ports: [{ hostPort: 8080, containerPort: 80, protocol: "tcp" }] })],
    );
    assert.equal(conflicts.length, 1);
    assert.match(conflicts[0].message, /nginx/);
  });

  it("container KENDİ portunu dinliyorsa çakışma SAYMAZ", () => {
    const own = container({
      name: "caddy",
      state: "running",
      ports: [{ hostPort: 8443, containerPort: 443, protocol: "tcp" }],
    });
    const conflicts = portConflicts(buildPortMap([socket({ port: 8443 })], [own]), [own]);
    assert.deepEqual(conflicts, []);
  });
});

describe("dockerPublishedPorts", () => {
  it("yalnızca ÇALIŞAN container'ların yayınladığı portları verir", () => {
    // ufw uyarısı buna dayanıyor: durmuş bir container ufw'yi atlamaz.
    const set = dockerPublishedPorts([
      container({ name: "acik", state: "running", ports: [{ hostPort: 8080, containerPort: 80, protocol: "tcp" }] }),
      container({ name: "kapali", state: "exited", ports: [{ hostPort: 8081, containerPort: 80, protocol: "tcp" }] }),
    ]);
    assert.equal(set.has(8080), true);
    assert.equal(set.has(8081), false);
  });
});

/**
 * M3.26 gerilemesinin regresyon testleri.
 *
 * Yaşanmış olay: passbolt'un compose sekmesi kendi 5000 portunu "başkası
 * tutuyor" diye ENGEL işaretledi ve kaydetmeyi kilitledi. Sebebi, sahibin
 * container adıyla (`passbolt-passbolt-1`) compose SERVİS adının (`passbolt`)
 * karşılaştırılmasıydı; ikisi hiçbir zaman eşleşmiyordu.
 */
describe("reservedByOthers", () => {
  const PID = "aa11bb22cc33dd44ee55ff66aa77bb88cc99dd00ee11ff22aa33bb44cc55dd66";
  const CADDY = "bb22cc33dd44ee55ff66aa77bb88cc99dd00ee11ff22aa33bb44cc55dd66aa77";

  const passbolt = container({
    id: PID,
    name: "passbolt-passbolt-1",
    composeProject: "passbolt",
    ports: [{ hostPort: 5000, containerPort: 80, protocol: "tcp" }],
  });
  const passboltDb = container({
    id: PID.replace(/^aa/, "cc"),
    name: "passbolt-db-1",
    composeProject: "passbolt",
    ports: [{ hostPort: 3307, containerPort: 3306, protocol: "tcp" }],
  });
  const caddy = container({
    id: CADDY,
    name: "server-panel-caddy-1",
    composeProject: "server-panel",
    ports: [{ hostPort: 443, containerPort: 443, protocol: "tcp" }],
  });

  const CONTAINERS = [passbolt, passboltDb, caddy];

  function port(over: Partial<ListeningPort> = {}): ListeningPort {
    return {
      protocol: "tcp",
      address: "0.0.0.0",
      port: 5000,
      wildcard: true,
      loopback: false,
      pid: null,
      process: "",
      owner: {
        kind: "container",
        name: "passbolt-passbolt-1",
        containerId: PID.slice(0, 12),
        composeProject: "passbolt",
      },
      ...over,
    };
  }

  it("container KENDİ portunu tutuyorsa çakışma SAYMAZ", () => {
    const map = reservedByOthers([port()], CONTAINERS, {
      project: "passbolt",
      container: PID,
    });
    assert.equal(map.has(5000), false);
  });

  it("AYNI YIĞINDAKİ başka servisin portu da çakışma sayılmaz", () => {
    // checkCompose belgenin TAMAMINI denetliyor; db'nin kendi portu da
    // düzenlenen dosyanın parçası ve compose up ikisini birlikte yeniliyor.
    const map = reservedByOthers(
      [
        port({
          port: 3307,
          owner: {
            kind: "container",
            name: "passbolt-db-1",
            containerId: passboltDb.id.slice(0, 12),
            composeProject: "passbolt",
          },
        }),
      ],
      CONTAINERS,
      { project: "passbolt", container: PID },
    );
    assert.equal(map.has(3307), false);
  });

  it("BAŞKA yığındaki container'ın portu ÇAKIŞMA SAYILIR", () => {
    // passbolt olayının gerçek çakışması: 443'ü caddy tutuyordu.
    const map = reservedByOthers(
      [
        port({
          port: 443,
          owner: {
            kind: "container",
            name: "server-panel-caddy-1",
            containerId: CADDY.slice(0, 12),
            composeProject: "server-panel",
          },
        }),
      ],
      CONTAINERS,
      { project: "passbolt", container: PID },
    );
    assert.equal(map.get(443), "server-panel-caddy-1");
  });

  it("host süreci portu tutuyorsa ÇAKIŞMA SAYILIR", () => {
    const map = reservedByOthers(
      [
        port({
          port: 22,
          process: "sshd",
          owner: { kind: "service", name: "ssh.service", containerId: "", composeProject: null },
        }),
      ],
      CONTAINERS,
      { project: "passbolt", container: PID },
    );
    assert.equal(map.get(22), "ssh.service");
  });

  it("container KISA id, TAM id ve AD ile verildiğinde aynı sonucu verir", () => {
    for (const ref of [PID, PID.slice(0, 12), "passbolt-passbolt-1"]) {
      const map = reservedByOthers([port()], CONTAINERS, { project: "passbolt", container: ref });
      assert.equal(map.has(5000), false, `${ref} ile hariç tutulmalıydı`);
    }
  });

  it("proje bilinmiyorsa YALNIZCA o container hariç tutulur", () => {
    const map = reservedByOthers(
      [
        port(),
        port({
          port: 3307,
          owner: {
            kind: "container",
            name: "passbolt-db-1",
            containerId: passboltDb.id.slice(0, 12),
            composeProject: "passbolt",
          },
        }),
      ],
      CONTAINERS,
      { project: null, container: PID },
    );
    assert.equal(map.has(5000), false);
    assert.equal(map.get(3307), "passbolt-db-1");
  });

  it("sahibi hiç çözülememiş portu süreç adıyla bildirir", () => {
    const map = reservedByOthers(
      [
        port({
          port: 9999,
          process: "bilinmeyen",
          owner: { kind: "process", name: "", containerId: "", composeProject: null },
        }),
      ],
      CONTAINERS,
      { project: "passbolt", container: PID },
    );
    assert.equal(map.get(9999), "bilinmeyen");
  });

  it("aynı port birden çok kez geçse de İLK sahibi tutulur", () => {
    // IPv4 ve IPv6 aynı portu iki satır olarak veriyor.
    const map = reservedByOthers(
      [
        port({ port: 443, owner: { kind: "container", name: "server-panel-caddy-1", containerId: CADDY.slice(0, 12), composeProject: "server-panel" } }),
        port({ protocol: "tcp6", port: 443, owner: { kind: "container", name: "server-panel-caddy-1", containerId: CADDY.slice(0, 12), composeProject: "server-panel" } }),
      ],
      CONTAINERS,
      { project: "passbolt", container: PID },
    );
    assert.equal(map.size, 1);
    assert.equal(map.get(443), "server-panel-caddy-1");
  });
});
