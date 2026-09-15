/**
 * Sağlayıcı arayüzleri (T10).
 *
 * Dış dünyaya dokunan her yetenek burada bir arayüz olarak tanımlanır ve
 * iki uygulaması olur: `*.live.ts` (gerçek) ve `*.mock.ts` (fixture).
 * Çağıran taraf hangisinin kullanıldığını bilmez — seçim `providers/index.ts`
 * içinde MOCK_MODE'a göre yapılır.
 *
 * Sonraki milestone'lar bu dosyaya eklenir: DockerProvider (M1.6),
 * HostHelperProvider (M1.13), BackupProvider (M3.4)...
 */

export interface SystemInfo {
  hostname: string;
  platform: string;
  /** Çekirdek sürümü (ör. "6.8.0-136-generic") */
  release: string;
  /** Dağıtım adı (ör. "Ubuntu 24.04.3 LTS") — host'a erişilemiyorsa null */
  osName: string | null;
  arch: string;
  cpuModel: string;
  cpuCount: number;
  totalMemBytes: number;
  uptimeSeconds: number;
}

export interface SystemProvider {
  info(): Promise<SystemInfo>;
}

/**
 * Tek bir metrik örneği (M1.1).
 *
 * `metric` + `label` ikilisi `metrics_raw` tablosundaki dar (EAV) şemaya
 * birebir karşılık gelir: `label` disk için mount noktası, ağ için arayüz
 * adı, geri kalanı için boş.
 */
export type MetricSample = {
  metric: string;
  label?: string;
  value: number;
};

// --- Donanım sağlığı (M1.4) ------------------------------------------------

export type TemperatureReading = {
  /** Kaynak + sensör: "coretemp / Package id 0" */
  id: string;
  source: string;
  label: string;
  celsius: number;
  /** Sürücünün bildirdiği eşikler (varsa) — ayardaki eşikten daha isabetli. */
  highC: number | null;
  criticalC: number | null;
};

export type SmartDisk = {
  device: string;
  model: string;
  serial: string | null;
  sizeBytes: number | null;
  /** PASSED | FAILED | bilinmiyor */
  health: string;
  temperatureC: number | null;
  powerOnHours: number | null;
  /** Arıza habercisi sayaçlar — sıfırdan büyükse disk gitmeye başlamıştır. */
  reallocatedSectors: number | null;
  pendingSectors: number | null;
  uncorrectableErrors: number | null;
  /** SSD/NVMe aşınma yüzdesi. */
  percentageUsed: number | null;
};

export type StoragePool = {
  name: string;
  kind: "mdraid" | "zfs";
  /** Ham durum metni: clean, degraded, ONLINE, DEGRADED, resilvering… */
  state: string;
  healthy: boolean;
  detail: string;
  devices: { name: string; state: string }[];
  lastScrubAt: number | null;
  scrubResult: string | null;
};

export type HardwareReport = {
  temperatures: TemperatureReading[];
  disks: SmartDisk[];
  pools: StoragePool[];
  /** S.M.A.R.T raporunun üretildiği an; host script hiç çalışmadıysa null. */
  reportedAt: number | null;
  /** "Microsoft Virtual Machine" gibi; fiziksel makinede null. */
  virtualization: string | null;
  /**
   * Eksik verinin SEBEBİ. Boş bir donanım paneli "arıza mı, yok mu?" sorusunu
   * cevapsız bırakır; burada neden okunamadığı yazılı olur.
   */
  notes: string[];
};

export interface HardwareProvider {
  report(): Promise<HardwareReport>;
}

/** Docker container'ının anlık durumu (M1.2 monitörü; M1.6'da genişleyecek). */
export interface ContainerState {
  name: string;
  running: boolean;
  /** running | exited | restarting | paused | created | dead */
  status: string;
  /** Docker healthcheck sonucu; container'da tanımlı değilse null. */
  health: string | null;
  restartCount: number;
  startedAt: string | null;
  /** Container TTY ile mi başlatıldı — log akışının çerçeveli olup olmadığını belirler. */
  tty: boolean;
}

export type ContainerPort = {
  hostIp: string | null;
  hostPort: number | null;
  containerPort: number;
  protocol: string;
};

/** `/containers/json` özeti — tabloyu doldurur (M1.6). */
export type ContainerSummary = {
  id: string;
  name: string;
  image: string;
  imageId: string;
  /** running | exited | restarting | paused | created | dead */
  state: string;
  /** Docker'ın insan okunur özeti: "Up 3 days (healthy)" */
  status: string;
  health: string | null;
  createdAt: number;
  ports: ContainerPort[];
  /** Compose etiketleri — M1.12 stack yönetimi buradan beslenecek. */
  composeProject: string | null;
  composeService: string | null;
  /**
   * Container'ın tüm etiketleri (M2.5 kart keşfi).
   *
   * Liste API'si bunları zaten döndürüyor; keşif turu için container başına
   * ayrı `inspect` çağırmak, 7 container'da 7 gidiş-dönüş demekti.
   */
  labels: Record<string, string>;
  /**
   * Bağlı olduğu Docker ağlarının adları.
   *
   * Yayınlama ekranı (M2.8) bunu kullanıyor: Caddy, hedef container'la ortak
   * bir ağda değilse container ADINI çözemez ve `reverse_proxy` 502 verir.
   * Bu, kullanıcının yalnızca Caddy loglarında görebileceği türden bir hata —
   * panel artık kaydı kaydetmeden önce söylüyor.
   *
   * Etiketlerle aynı gerekçe: liste API'si zaten döndürüyor, container başına
   * ayrı `inspect` çağırmaya gerek yok.
   */
  networks: string[];
  /**
   * `HostConfig.NetworkMode` — "bridge", "host", "none" ya da
   * "container:<id>" (M3.24).
   *
   * Ağ listesiyle karıştırılmamalı: host ağındaki bir container hiçbir bridge
   * ağında görünmez ama ağsız da değildir. Ağ haritası bu ayrımı yapabilmek
   * için buna bakıyor.
   */
  networkMode: string;
  /** İlk boş olmayan container IP'si; listedeki "IP" sütunu için. */
  ipAddress: string;
};

export type ContainerStats = {
  id: string;
  cpuPct: number;
  memUsed: number;
  memLimit: number;
  memPct: number;
  netRxBytes: number;
  netTxBytes: number;
  blockReadBytes: number;
  blockWriteBytes: number;
};

export type ContainerAction = "start" | "stop" | "restart" | "pause" | "unpause";

export type LogLine = {
  /** stdout | stderr */
  stream: string;
  /** Docker'ın eklediği zaman damgası (varsa). */
  ts: string | null;
  text: string;
};

// --- Docker derinliği (M1.8) ----------------------------------------------

export type DockerImage = {
  id: string;
  /** "homeassistant/home-assistant:stable" — etiketi kalmamışsa "<none>". */
  tags: string[];
  createdAt: number;
  sizeBytes: number;
  /** Bu image'ı kullanan container adları — boşsa image kullanılmıyor. */
  usedBy: string[];
  dangling: boolean;
  /**
   * "repo@sha256:…" — kayıt defterinden çekilen image'ın kimliği (M1.11).
   * Yerel derlenen image'larda boştur; güncelleme kontrolü bunlara bakmaz.
   */
  repoDigests: string[];
  /**
   * Image etiketleri (M3.27).
   *
   * Container etiketlerinden AYRI: `panel.prune=false` imajın kendisine
   * yazılıyor, çünkü budama kararı container'a değil imaja ait.
   */
  labels: Record<string, string>;
};

export type DockerVolume = {
  name: string;
  driver: string;
  mountpoint: string;
  createdAt: number | null;
  /** Volume'u mount eden container adları. */
  usedBy: string[];
  /** Compose'un oluşturduğu volume'lar etiketle işaretlidir. */
  composeProject: string | null;
};

export type DockerNetwork = {
  id: string;
  name: string;
  driver: string;
  scope: string;
  /** bridge/host/none — Docker'ın kendi ağları silinemez. */
  builtin: boolean;
  subnet: string | null;
  /** M3.41 — ağ geçidi; `/networks` listesinde zaten geliyordu, okunmuyordu. */
  gateway: string | null;
  /** Dış dünyaya çıkışı kapalı ağ. */
  internal: boolean;
  /** Compose dışından `docker network connect` ile bağlanılabilir mi. */
  attachable: boolean;
  labels: Record<string, string>;
  attached: string[];
  composeProject: string | null;
};

/** Yeni ağ tanımı (M3.41). Boş alanlar Docker'a HİÇ gönderilmiyor. */
export type NetworkSpec = {
  name: string;
  driver: string;
  internal: boolean;
  attachable: boolean;
  labels: Record<string, string>;
  /** Hepsi isteğe bağlı; boş bir subnet göndermek Docker'da hata. */
  subnet: string;
  gateway: string;
  ipRange: string;
};

/** Docker'ın `RestartPolicy` alanı; recreate gerektirmeden değiştirilebilir. */
export type RestartPolicy = {
  name: "no" | "always" | "unless-stopped" | "on-failure";
  maximumRetryCount: number;
};

/**
 * Container'ın yapılandırma özeti — detay ekranı ve bağımlılık çıkarımı için.
 * Ham `inspect` çıktısı da ayrıca sunuluyor; bu, sık kullanılan alanların
 * her yerde yeniden ayrıştırılmasını önleyen dar bir görünüm.
 */
export type ContainerDetail = {
  id: string;
  name: string;
  image: string;
  imageId: string;
  state: string;
  status: string;
  health: string | null;
  /** Healthcheck tanımlı değilse null; tanımlıysa son denemelerin çıktısı. */
  healthcheck: {
    test: string[];
    intervalSeconds: number | null;
    lastOutput: string | null;
    failingStreak: number;
  } | null;
  restartPolicy: RestartPolicy;
  restartCount: number;
  createdAt: number;
  startedAt: string | null;
  ports: ContainerPort[];
  env: { key: string; value: string }[];
  mounts: {
    type: string;
    source: string;
    destination: string;
    readOnly: boolean;
    volumeName: string | null;
  }[];
  networks: string[];
  /** "container:abc123" ise ağ yığını başka bir container'a ait. */
  networkMode: string;
  volumesFrom: string[];
  composeProject: string | null;
  composeService: string | null;
};

export type ResourceKind = "image" | "volume" | "network";

export type PruneScope =
  | "containers"
  | "images-dangling"
  | "images-unused"
  | "volumes"
  | "networks"
  | "build-cache";

export type PruneResult = {
  scope: PruneScope;
  removed: number;
  reclaimedBytes: number;
  /** Silinen kaynakların adları — kullanıcı ne gittiğini görsün. */
  items: string[];
};

export interface DockerProvider {
  /** Container yoksa null döner — bu bir hata değil, bir durumdur. */
  inspect(nameOrId: string): Promise<ContainerState | null>;
  /** `all` false ise yalnızca çalışanlar. */
  list(all: boolean): Promise<ContainerSummary[]>;
  /** Anlık kaynak kullanımı; container çalışmıyorsa null. */
  stats(id: string): Promise<ContainerStats | null>;
  /** start/stop/restart/pause/unpause (M1.7). */
  action(id: string, action: ContainerAction, stopTimeoutSeconds: number): Promise<void>;
  /**
   * Canlı log akışı. `signal` iptal edilince akış kapanır.
   *
   * `since` (unix saniye) verilirse Docker yalnızca o andan sonrasını gönderir;
   * merkezi log toplayıcı (M3.3) her turda baştan okumasın diye gerekli.
   */
  logs(
    id: string,
    options: { tail: number; follow: boolean; signal: AbortSignal; since?: number },
  ): AsyncGenerator<LogLine>;
  prune(scope: PruneScope): Promise<PruneResult>;

  // --- M1.8 ---
  /** Detay görünümü; container yoksa null. */
  detail(id: string): Promise<ContainerDetail | null>;
  /** Ham `inspect` çıktısı — panelin yorumlamadığı her şey burada. */
  inspectRaw(id: string): Promise<unknown | null>;
  images(): Promise<DockerImage[]>;
  volumes(): Promise<DockerVolume[]>;
  networks(): Promise<DockerNetwork[]>;
  /** Tekil kaynak silme. `force` yalnızca image için anlamlı. */
  removeResource(kind: ResourceKind, id: string, force: boolean): Promise<void>;
  /** Restart politikası recreate gerektirmeden değişir (Docker `/update`). */
  setRestartPolicy(id: string, policy: RestartPolicy): Promise<void>;

  // --- M1.11 (tek-tık image güncellemesi) ---
  /** Image'ı kayıt defterinden çeker; ilerleme satırları akış olarak gelir. */
  pullImage(reference: string): AsyncGenerator<string>;
  createContainer(name: string, payload: unknown): Promise<string>;
  renameContainer(id: string, name: string): Promise<void>;
  removeContainer(id: string, force: boolean): Promise<void>;
  connectNetwork(networkId: string, containerId: string, config: unknown): Promise<void>;

  // --- M2.8 ---
  /**
   * Container içinde TEK SEFERLİK bir komut çalıştırır ve biter.
   *
   * M1.9'daki etkileşimli terminalden farkı: TTY yok, oturum tutulmaz, çıktı
   * ve çıkış kodu tek parça döner. Caddy'yi yeniden yüklemek gibi işler için
   * terminal makinesini kurmak gereksiz ağırlık olurdu.
   */
  runOnce(nameOrId: string, command: string[]): Promise<ExecResult>;

  // --- M3.4 ---
  /**
   * Tek seferlik bir container yaratır, çalıştırır, çıktısını toplar ve siler.
   *
   * Yedekleme motoru restic'i böyle çalıştırıyor: host'a restic KURULMUYOR.
   * Sürüm imajla sabitleniyor, panel yalnızca zaten sahip olduğu docker.sock'u
   * kullanıyor ve host-helper izin listesine yeni bir satır gerekmiyor.
   */
  runThrowaway(spec: ThrowawaySpec): Promise<ExecResult>;

  // --- M3.23 (container içi dosya tarayıcı) ---
  /**
   * Container içindeki bir yolu TAR arşivi olarak okur.
   *
   * `docker cp <container>:<yol> -` ile aynı uç. Dizin verilirse arşiv o
   * dizinin İÇERİĞİNİ ÖZYİNELEMELİ taşır — bu yüzden çağıran, dizinleri
   * listelemek için bu yolu değil `runOnce` ile `ls`'i tercih etmeli;
   * `/` için özyinelemeli arşiv istemek tüm dosya sistemini indirmek olur.
   */
  readContainerArchive(id: string, path: string): Promise<Buffer>;

  /**
   * TAR arşivini container içindeki bir DİZİNE açar.
   *
   * Arşivdeki yollar hedef dizine göre göreli olmalı. Docker, hedef dizin
   * yoksa hata verir — panel bunu kullanıcıya olduğu gibi gösteriyor.
   */
  writeContainerArchive(id: string, directory: string, archive: Buffer): Promise<void>;

  // --- M3.24 (image ve volume detayı) ---
  /** Image'ın katman geçmişi — hangi Dockerfile satırı ne kadar yer kaplamış. */
  imageHistory(id: string): Promise<ImageLayer[]>;
  /** Ham `docker image inspect` çıktısı; panelin yorumlamadığı her şey. */
  inspectImageRaw(id: string): Promise<unknown | null>;
  /** Ham `docker volume inspect` çıktısı. */
  inspectVolumeRaw(name: string): Promise<unknown | null>;

  // --- M3.33 (volume klonlama) ---
  /**
   * Yeni bir named volume yaratır.
   *
   * Bind vermek de bir volume yaratıyor (Docker eksik olanı sessizce
   * oluşturuyor) ama VARSAYILAN sürücüyle. Klonlamada kaynağın sürücüsü,
   * seçenekleri ve etiketleri korunmak zorunda: NFS üzerindeki bir volume'ün
   * kopyası yerel diskte oluşursa "kopya" aslıyla aynı davranmaz.
   */
  // --- M3.39 (image dışa aktarma) ---
  /**
   * İmajı tar arşivi olarak döndürür (`docker save` ile aynı uç).
   *
   * ⚠️ Arşiv BELLEĞE alınıyor. Docker akış olarak veriyor ama panelin HTTP
   * yanıtına dönüştürmek için tamamının elde olması gerekiyor; bu yüzden
   * çağıran taraf boyutu ÖNDEN sınırlamak zorunda (M3.33'teki volume dışa
   * aktarmanın aynı kısıtı).
   */
  exportImage(id: string): Promise<Buffer>;

  // --- M3.41 (ağ yönetimi) ---
  /** Yeni ağ yaratır (`POST /networks/create`). */
  createNetwork(spec: NetworkSpec): Promise<void>;
  /**
   * Container'ı ağdan çıkarır.
   *
   * `connectNetwork`'ün karşılığı; ikisi olmadan arayüz bir container'ı ağa
   * bağlayıp geri alamaz hâle gelirdi.
   */
  disconnectNetwork(networkId: string, containerId: string, force: boolean): Promise<void>;

  createVolume(spec: {
    name: string;
    driver: string;
    driverOpts: Record<string, string>;
    labels: Record<string, string>;
  }): Promise<void>;
  /**
   * Bir imaja yeni bir etiket verir (`docker tag`) — M3.28.
   *
   * Güvenli çekme akışının temeli: `docker pull` yerel etiketi anında yeni
   * imaja çeviriyor, bu da çekme ile tarama arasında container'ın etiketinin
   * TARANMAMIŞ bir imajı göstermesi demek. Etiketi eski imaja geri almak bu
   * pencereyi kapatıyor.
   */
  tagImage(source: string, repo: string, tag: string): Promise<void>;

  /**
   * `docker system df` karşılığı — volume boyutları için.
   *
   * PAHALI: Docker her volume'ün diskteki boyutunu yürüyerek hesaplıyor ve bu
   * büyük volume'larda saniyeler sürebiliyor. Bu yüzden kaynak listesine
   * otomatik eklenmiyor, kullanıcı isteyince çağrılıyor.
   */
  diskUsage(): Promise<{ volumeBytes: Record<string, number> }>;
}

export type ImageLayer = {
  id: string;
  createdAt: number;
  /** Katmanı üreten Dockerfile komutu. */
  createdBy: string;
  sizeBytes: number;
  comment: string;
};

export type ThrowawaySpec = {
  image: string;
  cmd: string[];
  /** "kaynak:hedef:mod" — Docker bind sözdizimi. */
  binds: string[];
  env: Record<string, string>;
  /** Ad çakışmasını önlemek için panel benzersiz bir son ek ekler. */
  namePrefix: string;
  timeoutMs: number;
  /**
   * Container'ın çalışacağı kullanıcı ("0:0" = root). Verilmezse imajın
   * varsayılanı kullanılır.
   *
   * Panel container'ı bilinçli olarak yetkisiz bir kullanıcı (uid 1001) olarak
   * çalışıyor ve host kökünü o kimlikle okuyor — bu yüzden 750 izinli bir ev
   * dizinini göremiyor. Okuma işlemi bunu aşmak için root'a yükseliyor;
   * `docker.sock` zaten host'ta root demek olduğu için yeni bir yetki
   * kazanılmıyor, var olan yetki kullanılabilir hâle geliyor.
   */
  user?: string;
  /**
   * Host ağ ad alanı ("host") — dinleyen port envanteri (M3.7) için gerekli.
   * `/proc/net/*` ağ ad alanına bağlı olduğundan, container kendi ağında
   * kalırsa host'un portlarını göremez.
   */
  networkMode?: string;
  /** Host PID ad alanı ("host") — soket inode'unu sürece eşlemek için. */
  pidMode?: string;
  /**
   * Ek yetenekler (ör. "SYS_PTRACE").
   *
   * Port envanteri (M3.17) `/proc/<pid>/fd` sembolik bağlarını okumak zorunda
   * ve bu, hedef sürece ptrace erişimi gerektiriyor. Yeteneksiz bir container
   * yalnızca kendi profilindeki süreçleri okuyabiliyor.
   */
  capAdd?: string[];
  /**
   * Docker güvenlik seçenekleri.
   *
   * ⚠️ Gerçek bir genişletme; yalnızca gerekçesi yazılı olan çağıran geçmeli.
   * Sunucuda ölçüldü: Docker'ın varsayılan AppArmor profili ptrace'i "aynı
   * profildeki süreçler" ile sınırlıyor, bu yüzden SYS_PTRACE TEK BAŞINA host
   * süreçlerini açmıyor (bkz. T13).
   */
  securityOpt?: string[];
};

export type ExecResult = {
  exitCode: number;
  /** stdout ve stderr birleşik — hata mesajı hangisinden gelirse gelsin görünsün. */
  output: string;
  /**
   * Yalnızca stdout. JSON üreten araçlar için ZORUNLU: Trivy günlüğünü
   * stderr'e, sonucu stdout'a yazıyor; ikisi birleşince JSON ayrıştırılamıyor
   * (sunucuda yaşandı). `output` insan gözü için, bu alan makine için.
   */
  stdout?: string;
  stderr?: string;
};

export interface MetricsProvider {
  /**
   * Anlık örnek kümesi.
   *
   * Oran (rate) metrikleri — CPU yüzdesi, ağ bps — iki okuma arasındaki farka
   * dayanır. Bu yüzden ilk çağrı onları İÇERMEZ; sağlayıcı önceki okumayı
   * kendi içinde saklar. Çağıran taraf eksik metrik gelmesini normal karşılar.
   */
  sample(): Promise<MetricSample[]>;
}
