/**
 * Ağ topolojisinin saf modeli (M3.25).
 *
 * Soru şu: "hangi container hangi ağda ve kim kiminle konuşabilir?" Docker bu
 * bilgiyi iki ayrı yerden veriyor — ağın `attached` listesi ve container'ın
 * `networks` listesi — ve ikisi de tek başına eksik. Ağa hiç bağlı OLMAYAN bir
 * container yalnızca ikinci listeden anlaşılıyor; `network_mode: host` ise
 * hiçbirinde görünmüyor.
 *
 * Bu ayrım teorik değil: passbolt olayında container `compose up` yarıda
 * kaldığı için hiçbir ağa bağlı değildi. Bilgi paneldeydi ama hiçbir ekran
 * onu görünür kılmıyordu.
 *
 * I/O yok, `@/` yolu yok — `node --test` altında doğrudan çalışsın diye saf.
 */

export type GraphNetwork = {
  name: string;
  driver: string;
  /** Bu ağa bağlı container adları. */
  attached: string[];
  composeProject: string | null;
};

export type GraphContainer = {
  name: string;
  state: string;
  networks: string[];
  /** "host", "none", "bridge", "container:<id>" ya da ağ adı. */
  networkMode: string;
  composeProject: string | null;
};

export type GraphNode = {
  name: string;
  state: string;
  composeProject: string | null;
  /**
   * "bagli"   — en az bir ağda
   * "host"    — host ağını paylaşıyor, izole değil
   * "paylasan"— ağ yığını başka bir container'a ait
   * "yalniz"  — HİÇBİR ağda değil; yayınlanmış portları çalışmaz
   */
  kind: "bagli" | "host" | "paylasan" | "yalniz";
  networks: string[];
};

export type NetworkGraph = {
  networks: (GraphNetwork & { members: GraphNode[] })[];
  /** Hiçbir ağa bağlı olmayan, host ağındaki ya da yığın paylaşan düğümler. */
  loose: GraphNode[];
};

function siniflandir(container: GraphContainer): GraphNode["kind"] {
  if (container.networkMode === "host") return "host";
  if (container.networkMode.startsWith("container:")) return "paylasan";
  return container.networks.length > 0 ? "bagli" : "yalniz";
}

/**
 * Ağ ve container listelerinden grafiği kurar.
 *
 * Bir container birden çok ağdaysa her ağın üyesi olarak görünür ama TEK
 * düğüm nesnesi paylaşılır; arayüz onu vurgulayınca tüm bağlantıları birden
 * öne çıkabilsin diye.
 */
export function buildNetworkGraph(
  networks: GraphNetwork[],
  containers: GraphContainer[],
): NetworkGraph {
  const nodes = new Map<string, GraphNode>();

  for (const container of containers) {
    nodes.set(container.name, {
      name: container.name,
      state: container.state,
      composeProject: container.composeProject,
      kind: siniflandir(container),
      networks: [...container.networks].sort((a, b) => a.localeCompare(b, "tr")),
    });
  }

  const withMembers = networks
    .map((network) => {
      // `attached` ile container'ın kendi listesi ayrışabiliyor (ör. container
      // yeni bağlandı ama liste önbellekten geldi). İkisinin BİRLEŞİMİ alınıyor;
      // eksik göstermektense fazla göstermek teşhiste daha az zarar veriyor.
      const adlar = new Set(network.attached);
      for (const node of nodes.values()) {
        if (node.networks.includes(network.name)) adlar.add(node.name);
      }

      const members = [...adlar]
        .map(
          (name) =>
            nodes.get(name) ?? {
              name,
              state: "bilinmiyor",
              composeProject: null,
              kind: "bagli" as const,
              networks: [network.name],
            },
        )
        .sort((a, b) => a.name.localeCompare(b.name, "tr"));

      return { ...network, members };
    })
    .sort((a, b) => {
      // Kalabalık ağlar önce: boş ağlar listenin dibinde toplansın.
      if (a.members.length !== b.members.length) return b.members.length - a.members.length;
      return a.name.localeCompare(b.name, "tr");
    });

  const loose = [...nodes.values()]
    .filter((node) => node.kind !== "bagli")
    .sort((a, b) => {
      // "yalniz" olanlar en üstte: sorunlu olan onlar.
      const sira = { yalniz: 0, paylasan: 1, host: 2, bagli: 3 };
      if (sira[a.kind] !== sira[b.kind]) return sira[a.kind] - sira[b.kind];
      return a.name.localeCompare(b.name, "tr");
    });

  return { networks: withMembers, loose };
}

/**
 * İki container aynı ağı paylaşıyor mu — yani birbirinin ADINI çözebilir mi?
 *
 * Compose'un DNS'i ağ başına çalışıyor: ortak ağı olmayan iki servis birbirini
 * ad ile bulamaz ve hata yalnızca uygulamanın kendi loglarında görünür
 * ("connection refused", "no such host"). Yayınlama ekranı (M2.8) bu kontrolü
 * zaten yapıyordu; grafik de aynı gerçeği görsel olarak anlatıyor.
 */
export function sharesNetwork(a: GraphNode, b: GraphNode): boolean {
  if (a.kind === "host" && b.kind === "host") return true;
  return a.networks.some((network) => b.networks.includes(network));
}
