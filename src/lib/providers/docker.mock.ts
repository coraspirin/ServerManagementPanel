import { loadFixture } from "@/lib/fixtures";
import type {
  ContainerAction,
  ContainerDetail,
  ContainerStats,
  ContainerState,
  ContainerSummary,
  DockerImage,
  DockerNetwork,
  DockerProvider,
  DockerVolume,
  LogLine,
  PruneResult,
  PruneScope,
  RestartPolicy,
} from "./types";

type Fixture = {
  containers: (ContainerState & { id: string; image: string })[];
  summaries: ContainerSummary[];
  details: ContainerDetail[];
  images: DockerImage[];
  volumes: DockerVolume[];
  networks: DockerNetwork[];
};

let cached: Fixture | null = null;

async function fixture(): Promise<Fixture> {
  cached ??= await loadFixture<Fixture>("docker");
  return cached;
}

/** Tekrarlanabilir sahte kullanım — metrik üretecindeki mantığın aynısı. */
function noise(seed: string, ts: number): number {
  let hash = 2166136261;
  const input = `${seed}:${ts}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000;
}

/** MOCK_MODE'da aksiyonlar durumu bellekte değiştirir — ekran gerçekten tepki versin. */
const stateOverrides = new Map<string, string>();

export const mockDockerProvider: DockerProvider = {
  async inspect(nameOrId: string): Promise<ContainerState | null> {
    const { containers } = await fixture();
    return containers.find((c) => c.name === nameOrId || c.id === nameOrId) ?? null;
  },

  async list(all: boolean): Promise<ContainerSummary[]> {
    const { summaries } = await fixture();
    const withOverrides = summaries.map((container) => {
      // `networks` fixture'da eksik olabilir (sonradan eklenen alan); boş dizi
      // "ağ bilgisi yok" anlamına gelir ve uyarı üretmez — mock modda sahte
      // bir ağ uyumsuzluğu uyarısı göstermek yanıltıcı olurdu.
      const base = {
        ...container,
        networks: container.networks ?? [],
        // M3.24'te eklendi; eski fixture'larda yok. Boş dize "bilinmiyor"
        // demek ve ağ haritası bunu "bridge" gibi ele alıyor.
        networkMode: container.networkMode ?? "",
        ipAddress: container.ipAddress ?? "",
      };
      const state = stateOverrides.get(container.id);
      return state ? { ...base, state, status: `Durum elle değiştirildi: ${state}` } : base;
    });
    return all ? withOverrides : withOverrides.filter((c) => c.state === "running");
  },

  async stats(id: string): Promise<ContainerStats | null> {
    const { summaries } = await fixture();
    const container = summaries.find((c) => c.id === id);
    const state = stateOverrides.get(id) ?? container?.state;
    if (!container || state !== "running") return null;

    const window = Math.floor(Date.now() / 15_000);
    const memLimit = 2 * 1024 ** 3;
    const memUsed = Math.round(memLimit * (0.08 + noise(`${id}mem`, window) * 0.35));

    return {
      id,
      cpuPct: Number((noise(`${id}cpu`, window) * 22).toFixed(2)),
      memUsed,
      memLimit,
      memPct: Number(((memUsed / memLimit) * 100).toFixed(2)),
      netRxBytes: Math.round(noise(`${id}rx`, window) * 5e8),
      netTxBytes: Math.round(noise(`${id}tx`, window) * 2e8),
      blockReadBytes: Math.round(noise(`${id}br`, window) * 1e9),
      blockWriteBytes: Math.round(noise(`${id}bw`, window) * 4e8),
    };
  },

  async action(id: string, action: ContainerAction): Promise<void> {
    const { summaries } = await fixture();
    if (!summaries.some((c) => c.id === id)) throw new Error("container bulunamadı");

    stateOverrides.set(
      id,
      action === "stop" ? "exited" : action === "pause" ? "paused" : "running",
    );
  },

  async *logs(id, options): AsyncGenerator<LogLine> {
    const { summaries } = await fixture();
    const container = summaries.find((c) => c.id === id);
    if (!container) throw new Error("container bulunamadı");

    const samples = [
      ["stdout", "Başlatılıyor…"],
      ["stdout", `Yapılandırma okundu: /config/${container.name}.yaml`],
      ["stderr", "UYARI: 'legacy_mode' seçeneği kullanımdan kalkacak"],
      ["stdout", "MQTT broker'a bağlanıldı"],
      ["stdout", "Dinleniyor: 0.0.0.0:8080"],
    ] as const;

    for (let i = 0; i < Math.min(options.tail, samples.length); i++) {
      const [stream, text] = samples[i];
      yield { stream, ts: new Date(Date.now() - (samples.length - i) * 1000).toISOString(), text };
    }

    // MOCK_MODE'da da canlı akış hissi olsun ki arayüz gerçekten sınanabilsin.
    let counter = 0;
    while (options.follow && !options.signal.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (options.signal.aborted) break;
      yield {
        stream: counter % 5 === 4 ? "stderr" : "stdout",
        ts: new Date().toISOString(),
        text: `[MOCK] ${container.name} durum bildirimi #${++counter}`,
      };
    }
  },

  async prune(scope: PruneScope): Promise<PruneResult> {
    return {
      scope,
      removed: 3,
      reclaimedBytes: 412 * 1024 * 1024,
      items: ["sha256:aa11 (eski/servis:0.8)", "sha256:bb22 (<none>)", "gecici-volume"],
    };
  },

  // --- M1.8 ---

  async detail(id: string): Promise<ContainerDetail | null> {
    const { details } = await fixture();
    const entry = details.find((item) => item.id === id || item.name === id);
    if (!entry) return null;

    const override = restartPolicyOverrides.get(entry.id);
    return override ? { ...entry, restartPolicy: override } : entry;
  },

  async inspectRaw(id: string): Promise<unknown | null> {
    const detail = await this.detail(id);
    // Fixture'da ham Docker çıktısı tutulmuyor; detay görünümü ham JSON yerine
    // kendi özetini gösterir. Ekranın "ham veri yok" halini de sınamış oluyoruz.
    return detail ? { MOCK: true, ...detail } : null;
  },

  async images(): Promise<DockerImage[]> {
    return (await fixture()).images;
  },

  async volumes(): Promise<DockerVolume[]> {
    return (await fixture()).volumes;
  },

  async networks(): Promise<DockerNetwork[]> {
    // M3.41'de eklenen alanlar eski fixture'larda yok; `list()`teki desenin
    // aynısı — eksik alanı tanımsız bırakmak arayüzde "undefined" basardı.
    return (await fixture()).networks.map((network) => ({
      ...network,
      gateway: network.gateway ?? null,
      internal: network.internal ?? false,
      attachable: network.attachable ?? false,
      labels: network.labels ?? {},
    }));
  },

  async removeResource(kind, id): Promise<void> {
    if (kind === "network" && ["bridge", "host", "none"].includes(id)) {
      throw new Error("Docker'ın kendi ağı silinemez");
    }
  },

  async setRestartPolicy(id, policy): Promise<void> {
    restartPolicyOverrides.set(id, policy);
  },

  // --- M1.11 ---
  // Bu işlemler gerçek Docker olmadan taklit edilmiyor: "güncelledim" deyip
  // hiçbir şey yapmayan bir sahte, geliştirirken yanlış güven verirdi. API
  // katmanı MOCK_MODE'da zaten 503 döndürüp sebebini yazıyor.
  async *pullImage(): AsyncGenerator<string> {
    throw new Error("MOCK_MODE'da image çekilemez");
  },
  async createContainer(): Promise<string> {
    throw new Error("MOCK_MODE'da container oluşturulamaz");
  },
  async renameContainer(): Promise<void> {
    throw new Error("MOCK_MODE'da container adı değiştirilemez");
  },
  async removeContainer(): Promise<void> {
    throw new Error("MOCK_MODE'da container silinemez");
  },
  async connectNetwork(): Promise<void> {
    throw new Error("MOCK_MODE'da ağa bağlanılamaz");
  },

  // Başarılı dönüyor: MOCK_MODE'un amacı ekranı sınamak ve "Caddy yeniden
  // yüklendi" akışının nasıl göründüğü de sınanabilmeli.
  async runOnce(nameOrId: string, command: string[]) {
    return {
      exitCode: 0,
      output: `MOCK_MODE — çalıştırılmadı: ${nameOrId} $ ${command.join(" ")}`,
    };
  },

  async runThrowaway(spec) {
    // Yedekleme motoru (M3.4) restic'i böyle çağırıyor. MOCK_MODE'da gerçek
    // bir depoya yazmak tehlikeli olurdu; çıkış kodu 1 dönerek "çalışmadı"
    // demek, sahte başarı raporlamaktan dürüst.
    return {
      exitCode: 1,
      output:
        `MOCK_MODE — çalıştırılmadı: ${spec.image} ${spec.cmd.join(" ")}\n` +
        "Gerçek yedekleme için MOCK_MODE kapatılmalı.",
    };
  },

  async imageHistory() {
    // Fixture'da katman geçmişi yok; boş liste "katman bilgisi yok" olarak
    // gösteriliyor ve arayüz bunu doğru karşılıyor.
    return [];
  },

  async inspectImageRaw(id) {
    const { images } = await fixture();
    return images.find((image) => image.id === id) ?? null;
  },

  async inspectVolumeRaw(name) {
    const { volumes } = await fixture();
    return volumes.find((volume) => volume.name === name) ?? null;
  },

  async exportImage(id) {
    // Sahte bir tar üretip "arşiv hazır" demek, indirilen bozuk bir dosya
    // demekti. Hata vermek dürüst.
    throw new Error(`MOCK_MODE — imaj dışa aktarılamaz: ${id}`);
  },

  async createNetwork(spec) {
    throw new Error(`MOCK_MODE — ağ oluşturulamaz: ${spec.name}`);
  },

  async disconnectNetwork() {
    throw new Error("MOCK_MODE'da ağ bağlantısı kesilemez");
  },

  async createVolume(spec) {
    // MOCK_MODE'da volume deposu yok; sessizce başarılı dönmek, klonlama
    // akışının işlediği yanılgısını verirdi.
    throw new Error(`MOCK_MODE — volume oluşturulamaz: ${spec.name}`);
  },

  async tagImage(source, repo, tag) {
    // MOCK_MODE'da imaj deposu yok; sessizce başarılı dönmek, güvenli çekme
    // akışının işlediği yanılgısını verirdi.
    throw new Error(`MOCK_MODE — imaj etiketlenemez: ${source} → ${repo}:${tag}`);
  },

  async diskUsage() {
    // MOCK_MODE'da disk yürüyüşü yapılamaz; boş harita "boyut bilinmiyor"
    // demek ve arayüz tire gösteriyor.
    return { volumeBytes: {} };
  },

  async readContainerArchive(id, path) {
    // Sahte bir tar üretip "dosya var" demek, arayüzü var olmayan içerikle
    // doldururdu. Hata vermek dürüst: MOCK_MODE'da container dosya sistemi yok.
    throw new Error(`MOCK_MODE — container dosyası okunamaz: ${id}:${path}`);
  },

  async writeContainerArchive(id, directory) {
    throw new Error(`MOCK_MODE — container dosyası yazılamaz: ${id}:${directory}`);
  },
};

/** MOCK_MODE'da politika değişikliği bellekte tutulur; ekran tepki versin. */
const restartPolicyOverrides = new Map<string, RestartPolicy>();
