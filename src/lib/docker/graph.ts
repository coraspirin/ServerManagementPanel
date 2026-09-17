import type {
  ContainerDetail,
  DockerImage,
  DockerNetwork,
  DockerVolume,
} from "@/lib/providers/types";
import { serverT } from "../i18n/runtime.ts";

/**
 * Container bağımlılıkları (M1.8).
 *
 * Docker bağımlılık diye bir kavram TUTMAZ — `depends_on` yalnızca compose'un
 * başlatma sırasıdır ve container oluştuktan sonra hiçbir yerde saklanmaz.
 * Bu yüzden bağımlılık, çalışan yapılandırmadan ÇIKARILIYOR. İki farklı
 * güçte ilişki var ve bunları ayırmak şart:
 *
 *   - **sert**: durdurursan diğeri teknik olarak çalışamaz. Ağ yığınını
 *     paylaşan (`network_mode: container:X`) ya da mount'larını devralan
 *     (`volumes_from`) container ayakta kalamaz.
 *   - **yumuşak**: durdurursan diğeri ayakta kalır ama işlevini kaybeder.
 *     Zigbee2MQTT, Mosquitto durunca çöker mi? Hayır — ama hiçbir mesaj
 *     iletemez. Kullanıcıya "etkilenir" demek yeterli, "çöker" demek yanlış.
 *
 * Yumuşak ilişki için ölçüt PAYLAŞILAN ÖZEL AĞ. `bridge`/`host`/`none`
 * sayılmaz: varsayılan köprüde olan iki container'ın birbiriyle ilgisi
 * olmayabilir, oysa aynı compose ağındaki ikisi birbirini isimle çağırabilir.
 */

const BUILTIN_NETWORKS = new Set(["bridge", "host", "none"]);

export type DependencyKind =
  | "ag-yigini"
  | "volumes-from"
  | "ozel-ag"
  | "paylasilan-volume"
  | "compose"
  | "host-agi";

export type Dependency = {
  /** Etkilenen container'ın adı. */
  name: string;
  kind: DependencyKind;
  hard: boolean;
  /** Kullanıcıya gösterilecek gerekçe. */
  reason: string;
};

function userNetworks(detail: ContainerDetail): string[] {
  return detail.networks.filter((name) => !BUILTIN_NETWORKS.has(name));
}

/**
 * Host ağını kullanan container'lar birbirine `localhost` üzerinden erişir.
 *
 * Bu, gerçek kurulumda ortaya çıkan bir kör nokta: Home Assistant, Mosquitto
 * ve Zigbee2MQTT'nin üçü de host ağında olduğu için aralarında hiçbir Docker
 * ağı, volume ya da compose bağı görünmüyordu — oysa ikisi diğerinin MQTT
 * istemcisi. Sinyal zayıf (host ağındaki her container böyle eşleşir) ve bu
 * yüzden en sona konuldu; ama hiç göstermemek, sistemdeki en önemli ilişkiyi
 * gizlemek demekti.
 */
function usesHostNetwork(detail: ContainerDetail): boolean {
  return detail.networkMode === "host" || detail.networks.includes("host");
}

function volumeNames(detail: ContainerDetail): string[] {
  return detail.mounts
    .map((mount) => mount.volumeName)
    .filter((name): name is string => name !== null);
}

/** `network_mode: container:X` — X id ya da isim olabilir. */
function sharesNetworkStackWith(detail: ContainerDetail, target: ContainerDetail): boolean {
  const prefix = "container:";
  if (!detail.networkMode.startsWith(prefix)) return false;

  const reference = detail.networkMode.slice(prefix.length);
  return reference === target.name || target.id.startsWith(reference);
}

/**
 * `target` durdurulursa etkilenecek container'lar.
 *
 * Kendisi listeye girmez; her container en fazla bir kez ve en GÜÇLÜ
 * gerekçesiyle listelenir — "hem aynı ağda hem aynı stack'te" demek
 * kullanıcıya iki satır göstermeyi değil, en ciddi olanı söylemeyi gerektirir.
 */
export function impactOfStopping(
  target: ContainerDetail,
  all: ContainerDetail[],
): Dependency[] {
  const targetNetworks = new Set(userNetworks(target));
  const targetVolumes = new Set(volumeNames(target));
  const found = new Map<string, Dependency>();

  const add = (dependency: Dependency) => {
    const existing = found.get(dependency.name);
    // Sert ilişki yumuşağı her zaman ezer.
    if (!existing || (dependency.hard && !existing.hard)) found.set(dependency.name, dependency);
  };

  for (const other of all) {
    if (other.id === target.id) continue;

    if (sharesNetworkStackWith(other, target)) {
      add({
        name: other.name,
        kind: "ag-yigini",
        hard: true,
        reason: serverT("dependency.networkMode"),
      });
      continue;
    }

    if (other.volumesFrom.some((ref) => ref === target.name || target.id.startsWith(ref))) {
      add({
        name: other.name,
        kind: "volumes-from",
        hard: true,
        reason: serverT("dependency.volumesFrom"),
      });
      continue;
    }

    const sharedNetwork = userNetworks(other).find((name) => targetNetworks.has(name));
    if (sharedNetwork) {
      add({
        name: other.name,
        kind: "ozel-ag",
        hard: false,
        reason: serverT("dependency.sharedNetwork", { network: sharedNetwork }),
      });
      continue;
    }

    const sharedVolume = volumeNames(other).find((name) => targetVolumes.has(name));
    if (sharedVolume) {
      add({
        name: other.name,
        kind: "paylasilan-volume",
        hard: false,
        reason: serverT("dependency.sharedVolume", { volume: sharedVolume }),
      });
      continue;
    }

    if (target.composeProject && other.composeProject === target.composeProject) {
      add({
        name: other.name,
        kind: "compose",
        hard: false,
        reason: serverT("dependency.sameStack", { stack: target.composeProject ?? "" }),
      });
      continue;
    }

    if (usesHostNetwork(target) && usesHostNetwork(other)) {
      add({
        name: other.name,
        kind: "host-agi",
        hard: false,
        reason: serverT("dependency.hostNetwork"),
      });
    }
  }

  return [...found.values()].sort((a, b) => {
    if (a.hard !== b.hard) return a.hard ? -1 : 1;
    return a.name.localeCompare(b.name, "tr");
  });
}

/** Grafik çizimi için tüm kenarlar: kaynak durursa hedef etkilenir. */
export type GraphEdge = { from: string; to: string; kind: DependencyKind; hard: boolean };

export function dependencyEdges(all: ContainerDetail[]): GraphEdge[] {
  return all.flatMap((detail) =>
    impactOfStopping(detail, all).map<GraphEdge>((dependency) => ({
      from: detail.name,
      to: dependency.name,
      kind: dependency.kind,
      hard: dependency.hard,
    })),
  );
}

// --- Kullanılmayan kaynak raporu -------------------------------------------

export type UnusedReport = {
  images: { id: string; label: string; sizeBytes: number; dangling: boolean }[];
  volumes: { name: string; composeProject: string | null }[];
  networks: { id: string; name: string }[];
  /** Image'lar silinirse geri kazanılacak yaklaşık alan. */
  reclaimableBytes: number;
};

/**
 * Kullanılmayan kaynaklar.
 *
 * "Kullanılmıyor" burada **durmuş container'lar da dahil** hiçbir container'ın
 * referans vermediği anlamına gelir. Yalnızca çalışanlara bakmak, geçici
 * olarak durdurulmuş bir servisin volume'unu "öksüz" göstermek demekti — ve
 * o volume silindiğinde veri geri gelmez.
 */
export function unusedResources(
  images: DockerImage[],
  volumes: DockerVolume[],
  networks: DockerNetwork[],
): UnusedReport {
  const unusedImages = images.filter((image) => image.usedBy.length === 0);

  return {
    images: unusedImages.map((image) => ({
      id: image.id,
      label: image.tags[0] ?? serverT("docker.images.untagged"),
      sizeBytes: image.sizeBytes,
      dangling: image.dangling,
    })),
    volumes: volumes
      .filter((volume) => volume.usedBy.length === 0)
      .map((volume) => ({ name: volume.name, composeProject: volume.composeProject })),
    networks: networks
      .filter((network) => !network.builtin && network.attached.length === 0)
      .map((network) => ({ id: network.id, name: network.name })),
    reclaimableBytes: unusedImages.reduce((total, image) => total + image.sizeBytes, 0),
  };
}
