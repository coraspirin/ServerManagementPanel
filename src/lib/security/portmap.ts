/**
 * M3.17 — port sahipliği, boş port bulucu ve çakışma tespiti.
 *
 * Bu dosyada I/O YOK: `ports.ts` host'tan ham veriyi toplar, buradaki saf
 * fonksiyonlar o veriden anlam çıkarır. Ayrılmasının sebebi test edilebilirlik
 * — sahiplik zinciri ve boş port mantığı, container açmadan doğrulanabilmeli.
 *
 * SAHİPLİK NEDEN ÜÇ KAYNAKTAN ÇÖZÜLÜYOR:
 *
 *   1. cgroup → container id. Tek güvenilir yol, çünkü `network_mode: host`
 *      çalışan bir container hiç port YAYINLAMAZ; port haritasından bakan bir
 *      eşleme onu asla bulamaz.
 *   2. hostPort → container adı. Yayınlanmış portlarda soketi dinleyen süreç
 *      `docker-proxy`'dir ve onun cgroup'u host tarafındadır — 1. yol burada
 *      container'ı değil docker'ın kendisini gösterir, bu yüzden gerekli.
 *   3. cgroup → systemd unit. "Hangi sistem servisi" sorusunun cevabı.
 *
 * Unit adı için `systemctl show --property=MainPID` ÇAĞRILMIYOR: cgroup yolu
 * unit adını zaten taşıyor, o yüzden host-helper'a yeni bir izin açmaya gerek
 * kalmıyor (T4). Alternatif, her port için ayrı bir helper turu ve
 * `allow.conf`'ta yeni bir satır demekti.
 */

export type PortOwnerKind = "container" | "service" | "process" | "unknown";

export type PortOwner = {
  kind: PortOwnerKind;
  /** container adı / unit adı / süreç adı. Bilinmiyorsa "". */
  name: string;
  /** Container ise kısa id (12 karakter), değilse "". */
  containerId: string;
  composeProject: string | null;
};

/** Container içindeki script'in ürettiği ham satır. */
export type RawSocket = {
  protocol: "tcp" | "tcp6" | "udp" | "udp6";
  address: string;
  port: number;
  pid: number | null;
  process: string;
  /** `/proc/<pid>/cgroup` içeriği, satırlar boşlukla birleştirilmiş. */
  cgroup: string;
};

export type ListeningPort = {
  protocol: "tcp" | "tcp6" | "udp" | "udp6";
  address: string;
  port: number;
  /** Her arayüzden erişilebilir mi (0.0.0.0 / ::). */
  wildcard: boolean;
  /** Yalnızca yerel döngüde mi (127.0.0.1 / ::1). */
  loopback: boolean;
  pid: number | null;
  /** Ham süreç adı (`/proc/<pid>/comm`) — sahip çözülemese bile gösterilir. */
  process: string;
  owner: PortOwner;
};

/**
 * portmap'in container hakkında bilmesi gereken her şey.
 *
 * `ContainerSummary`'nin tamamı değil: bu modülün provider tiplerine bağımlı
 * olmaması, testlerde koca bir nesne uydurmayı gereksiz kılıyor.
 */
export type ContainerFacts = {
  id: string;
  name: string;
  /** running | exited | created | ... */
  state: string;
  composeProject: string | null;
  ports: { hostPort: number | null; containerPort: number; protocol: string }[];
};

const WILDCARD = new Set(["0.0.0.0", "::"]);
const LOOPBACK = new Set([
  "127.0.0.1",
  "::1",
  "0000:0000:0000:0000:0000:0000:0000:0001",
]);

/**
 * cgroup satırından container id ve systemd unit adı.
 *
 * Karşılaşılan biçimler:
 *   cgroup v1 docker : `10:cpu:/docker/<64hex>`
 *   cgroup v2 docker : `0::/system.slice/docker-<64hex>.scope`
 *   systemd servisi  : `0::/system.slice/ssh.service`
 *   şablonlu unit    : `0::/system.slice/system-getty.slice/getty@tty1.service`
 *   kullanıcı oturumu: `0::/user.slice/user-1000.slice/session-3.scope`
 *
 * docker-<hex>.scope'un system.slice ALTINDA durduğuna dikkat: unit araması
 * container kontrolünden SONRA yapılmalı, yoksa her container "docker.service"
 * gibi görünürdü.
 */
export function parseCgroup(cgroup: string): { containerId: string; unit: string } {
  const container = cgroup.match(/(?:^|[/-])(?:docker[-/]|containerd-)?([0-9a-f]{64})(?:\.scope)?\b/);
  if (container) return { containerId: container[1].slice(0, 12), unit: "" };

  const unit = cgroup.match(/\/((?:[A-Za-z0-9@:_.\\-]+))\.service\b/);
  if (unit) return { containerId: "", unit: `${unit[1]}.service` };

  return { containerId: "", unit: "" };
}

/**
 * Bir soketin sahibini üç kaynağın önceliğine göre belirler.
 *
 * `byHostPort` cgroup'tan ÖNCE gelmiyor ama `docker-proxy` için tek çare o
 * olduğundan, cgroup bir container vermediğinde ve süreç docker'a aitse
 * devreye giriyor.
 */
export function resolveOwner(
  row: RawSocket,
  containers: ContainerFacts[],
): PortOwner {
  const { containerId, unit } = parseCgroup(row.cgroup);

  if (containerId) {
    const match = containers.find((entry) => entry.id.startsWith(containerId));
    if (match) {
      return {
        kind: "container",
        name: match.name,
        containerId,
        composeProject: match.composeProject,
      };
    }
    // cgroup container diyor ama Docker listesinde yok: başka bir runtime ya da
    // panelin göremediği bir container. Gerçeği söyle, uydurma.
    return { kind: "container", name: "", containerId, composeProject: null };
  }

  // docker-proxy: soketi docker tutuyor, portu bir container adına açmış.
  const published = containers.find((entry) =>
    entry.ports.some((port) => port.hostPort === row.port),
  );
  if (published) {
    return {
      kind: "container",
      name: published.name,
      containerId: published.id.slice(0, 12),
      composeProject: published.composeProject,
    };
  }

  if (unit) return { kind: "service", name: unit, containerId: "", composeProject: null };
  if (row.process) {
    return { kind: "process", name: row.process, containerId: "", composeProject: null };
  }
  return { kind: "unknown", name: "", containerId: "", composeProject: null };
}

/** Ham satırları sahibi çözülmüş, sıralanmış port listesine dönüştürür. */
export function buildPortMap(
  rows: RawSocket[],
  containers: ContainerFacts[],
): ListeningPort[] {
  const ports = rows.map((row) => ({
    protocol: row.protocol,
    address: row.address,
    port: row.port,
    wildcard: WILDCARD.has(row.address),
    loopback: LOOPBACK.has(row.address),
    pid: row.pid,
    process: row.process,
    owner: resolveOwner(row, containers),
  }));

  // Aynı port hem tcp hem tcp6'da görünebilir; ikisi de gerçek, ikisi de
  // gösteriliyor. Sıralama: dış dünyaya açık olanlar önce.
  ports.sort((a, b) => {
    if (a.wildcard !== b.wildcard) return a.wildcard ? -1 : 1;
    if (a.loopback !== b.loopback) return a.loopback ? 1 : -1;
    return a.port - b.port;
  });

  return ports;
}

export type Reservation = {
  port: number;
  /** listening: şu an bir süreç dinliyor. declared: container portu yayınlıyor ama çalışmıyor. */
  kind: "listening" | "declared";
  /** Sahip adı — container/servis/süreç. */
  owner: string;
  /** declared ise container durumu ("exited"), listening ise "". */
  state: string;
};

/**
 * Portu BAŞKASI mı tutuyor — düzenlenen yığının kendisi hariç (M3.26).
 *
 * Var olan bir compose servisini düzenlerken sorulan soru "bu port meşgul mü"
 * değil, **"bu portu benden başkası mı tutuyor"**. Bir container'ın kendi
 * yayınladığı portu çakışma saymak, hiçbir servisin kendi portuna
 * dokunamaması demek.
 *
 * ⚠️ HARİÇ TUTMA CONTAINER DEĞİL, PROJE BAZINDA. `checkCompose` belgedeki
 * BÜTÜN servisleri denetliyor; yalnızca düzenlenen container'ı elemek, aynı
 * yığındaki diğer servislerin kendi portları için sahte çakışma üretirdi.
 * `compose up` zaten tüm yığını birlikte yeniden yaratıyor, yani o
 * container'ların portları serbest kalıyor.
 *
 * Bu mantık M3.21'e kadar route içinde, testsiz bir satırdaydı ve sahip adını
 * (container adı: `passbolt-passbolt-1`) compose SERVİS adıyla (`passbolt`)
 * karşılaştırıyordu; ikisi hiçbir zaman eşleşmediği için hariç tutma hiç
 * çalışmadı. Bulgu "uyarı" iken görünmeyen bu hata, `engel`e yükseltilince
 * düzenlemeyi tamamen kilitledi.
 *
 * @param self.project   Düzenlenen compose projesi; yoksa `null`.
 * @param self.container Tam id, kısa id ya da container adı.
 */
export function reservedByOthers(
  ports: ListeningPort[],
  containers: ContainerFacts[],
  self: { project: string | null; container: string },
): Map<number, string> {
  const kendisi = containers.find(
    (entry) =>
      entry.name === self.container ||
      entry.id === self.container ||
      (self.container.length >= 8 && entry.id.startsWith(self.container)) ||
      (entry.id.length >= 8 && self.container.startsWith(entry.id)),
  );

  // Projesi bilinen her container hariç; bilinmiyorsa yalnızca kendisi.
  const haric =
    self.project !== null
      ? containers.filter((entry) => entry.composeProject === self.project)
      : kendisi
        ? [kendisi]
        : [];

  const haricAdlar = new Set(haric.map((entry) => entry.name).filter(Boolean));
  const haricIdler = haric.map((entry) => entry.id).filter(Boolean);

  const bize_mi_ait = (owner: PortOwner): boolean => {
    if (owner.name && haricAdlar.has(owner.name)) return true;
    // cgroup yoluyla çözülen sahiplerde id KISALTILMIŞ geliyor; iki yönlü
    // ön ek karşılaştırması gerekiyor.
    if (!owner.containerId) return false;
    return haricIdler.some(
      (id) => id.startsWith(owner.containerId) || owner.containerId.startsWith(id),
    );
  };

  const map = new Map<number, string>();
  for (const port of ports) {
    if (bize_mi_ait(port.owner)) continue;
    const owner = port.owner.name || port.process;
    if (!owner) continue;
    if (!map.has(port.port)) map.set(port.port, owner);
  }

  return map;
}

/**
 * "Bu port meşgul mü?" sorusunun cevabı.
 *
 * DURMUŞ CONTAINER'IN PORTU DA MEŞGULDÜR. Şu an kimse dinlemiyor olabilir ama
 * o container başlatıldığında port çakışır ve Docker "port is already
 * allocated" der. Yeni bir container'a port seçerken sorulan soru "şu an boş
 * mu" değil, "çakışır mı" — bu yüzden `list(true)` ile durmuş container'lar da
 * hesaba katılıyor.
 */
export function reservedPorts(
  ports: ListeningPort[],
  containers: ContainerFacts[],
): Map<number, Reservation[]> {
  const map = new Map<number, Reservation[]>();

  const push = (port: number, entry: Reservation) => {
    const list = map.get(port);
    if (list) list.push(entry);
    else map.set(port, [entry]);
  };

  for (const port of ports) {
    push(port.port, {
      port: port.port,
      kind: "listening",
      owner: port.owner.name || port.process || "bilinmiyor",
      state: "",
    });
  }

  for (const container of containers) {
    if (container.state === "running") continue;
    for (const port of container.ports) {
      if (port.hostPort === null) continue;
      push(port.hostPort, {
        port: port.hostPort,
        kind: "declared",
        owner: container.name,
        state: container.state,
      });
    }
  }

  return map;
}

/**
 * Aralıktaki ilk `count` boş portu döndürür.
 *
 * Aralık ters verilirse (from > to) uçlar takas edilir; boş liste döndürmek
 * kullanıcıya "hiç boş port yok" gibi yanlış bir cevap verirdi.
 */
export function freePorts(
  reserved: Map<number, Reservation[]>,
  from: number,
  to: number,
  count: number,
): number[] {
  const low = Math.max(1, Math.min(from, to));
  const high = Math.min(65535, Math.max(from, to));
  const out: number[] = [];

  for (let port = low; port <= high && out.length < count; port += 1) {
    if (!reserved.has(port)) out.push(port);
  }

  return out;
}

export type Conflict = {
  port: number;
  message: string;
};

/**
 * Gerçek çakışmalar — "şüpheli" değil, container başlatıldığında PATLAYACAK
 * olanlar.
 *
 * İki durum var: aynı hostPort'u iki container'ın yayınlaması, ve durmuş bir
 * container'ın istediği portu başka birinin şu an dinliyor olması.
 */
export function portConflicts(
  ports: ListeningPort[],
  containers: ContainerFacts[],
): Conflict[] {
  const conflicts: Conflict[] = [];
  const claims = new Map<number, string[]>();

  for (const container of containers) {
    for (const port of container.ports) {
      if (port.hostPort === null) continue;
      const list = claims.get(port.hostPort) ?? [];
      if (!list.includes(container.name)) list.push(container.name);
      claims.set(port.hostPort, list);
    }
  }

  for (const [port, names] of claims) {
    if (names.length > 1) {
      conflicts.push({
        port,
        message: `${names.join(", ")} aynı host portunu yayınlıyor — ikisi birden çalışamaz.`,
      });
    }
  }

  const listeningBy = new Map<number, string>();
  for (const port of ports) {
    if (!listeningBy.has(port.port)) {
      listeningBy.set(port.port, port.owner.name || port.process || "bilinmeyen süreç");
    }
  }

  for (const container of containers) {
    if (container.state === "running") continue;
    for (const port of container.ports) {
      if (port.hostPort === null) continue;
      const holder = listeningBy.get(port.hostPort);
      // Sahip container'ın kendisiyse çakışma yok — kendi portunu dinliyordur.
      if (!holder || holder === container.name) continue;
      conflicts.push({
        port: port.hostPort,
        message: `${container.name} (${container.state}) başlatılırsa ${port.hostPort} portunu ${holder} tuttuğu için çakışır.`,
      });
    }
  }

  return conflicts.sort((a, b) => a.port - b.port);
}

/**
 * Docker'ın yayınladığı host portları.
 *
 * Güvenlik duvarı ekranı (M3.18) bunu kullanıyor: DOCKER, UFW'Yİ ATLAR —
 * Docker kendi iptables kurallarını `DOCKER-USER` zincirine ve nat
 * `PREROUTING`'e yazar, bunlar ufw'nin `filter INPUT` zincirinden önce çalışır.
 * Yani yayınlanmış bir porta yazılan `ufw deny` kuralı ETKİSİZDİR ve kullanıcı
 * bunu bilmeden kendini korunmuş sanar.
 */
export function dockerPublishedPorts(containers: ContainerFacts[]): Set<number> {
  const set = new Set<number>();
  for (const container of containers) {
    if (container.state !== "running") continue;
    for (const port of container.ports) {
      if (port.hostPort !== null) set.add(port.hostPort);
    }
  }
  return set;
}
