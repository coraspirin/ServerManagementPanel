/**
 * Çalışan bir container'dan `docker-compose.yml` üretme (M3.31).
 *
 * ## Neden gerekiyor
 *
 * Compose düzenleyicimiz (M3.19) yalnızca compose'a ait container'larda
 * çalışıyor: `com.docker.compose.project` etiketi yoksa dosya da yok, düzenlenecek
 * bir şey de. `docker run` ile ya da elle başlatılmış container'lar bu yüzden
 * panelin yarısından yararlanamıyor — port değiştirmek, ağ eklemek, ortam
 * değişkeni düzenlemek onlarda kapalı.
 *
 * Bu modül köprü: yönetilmeyen bir container'ı yönetilebilir hâle getiriyor.
 *
 * ## Asıl iş: gürültüyü ayıklamak
 *
 * Ham inspect çıktısını olduğu gibi YAML'a dökmek işe yaramaz. Docker
 * container'a kendi varsayılanlarını da yazıyor: imajın `Entrypoint`'i,
 * `Cmd`'si, `Env`'i, `Labels`'ı ve üretilmiş bir `Hostname`. Bunları compose
 * dosyasına yazmak iki zarar veriyor:
 *
 * 1. **Dosya okunmaz oluyor** — üç satırlık bir servis, kırk satırlık bir
 *    döküme dönüşüyor.
 * 2. **Değerler donuyor** — imaj güncellendiğinde yeni `Entrypoint` gelmiyor,
 *    compose dosyasındaki eski değer geçerli kalıyor. Bu, M3.28'de
 *    güncellemede düzelttiğimiz hatanın aynısının compose tarafındaki hâli.
 *
 * Ayrım [inherit.ts](../docker/inherit.ts) ile aynı mantığı paylaşıyor:
 * container'daki değer imajınkiyle aynıysa kullanıcının değil imajın, düşer.
 *
 * ## `com.docker.compose.*` etiketlerinde inherit.ts'ten AYRILIYOR
 *
 * Orada korunuyorlar (container'ın hangi yığına ait olduğunun tek kaydı),
 * burada atılıyorlar: compose bu etiketleri kendi yazar ve üretilen dosyaya
 * elle yazmak, container'ı var olmayan bir projeye ait göstermek olurdu.
 *
 * I/O yok, `@/` yolu yok — `node --test` altında doğrudan çalışsın diye saf.
 */

import { Document } from "yaml";

import { inheritEnv } from "../docker/inherit.ts";

export type EnvMode = "user" | "all";

export type GenerateOptions = {
  /** Servis adı; verilmezse container adından türetilir. */
  serviceName?: string;
  /**
   * `user` = yalnızca kullanıcının verdiği/değiştirdiği değişkenler.
   *
   * Varsayılan bu, çünkü `all` bir imajın `PATH`, `LANG`, `NODE_VERSION` gibi
   * onlarca varsayılanını dosyaya donduruyor.
   */
  env: EnvMode;
};

export type GenerateResult = {
  /** Üretilen compose metni. */
  yaml: string;
  /** Servis adı — kaydetme ekranı yığın adı önerisinde kullanıyor. */
  serviceName: string;
  /**
   * Taşınamayan ya da dikkat isteyen şeyler.
   *
   * Sessizce eksik bırakmak en kötüsü olurdu: kullanıcı üretilen dosyayı
   * "container'ın aynısı" sanıp eskisini silerse, taşınmayan her ayar veri ya
   * da erişim kaybı demek.
   */
  warnings: string[];
};

/* -------------------------------------------------------------------------- */
/* Ham inspect çıktısından savunmacı okuma                                     */
/* -------------------------------------------------------------------------- */

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function strings(value: unknown): string[] {
  return list(value).map(String);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** İki dizi aynı mı — imajdan devralınan cmd/entrypoint'i ayırmak için. */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Servis adı: container adından compose'un kabul ettiği biçime.
 *
 * Compose servis adları küçük harf, rakam, tire ve alt çizgi kabul ediyor.
 * `/passbolt-passbolt-1` gibi bir ad baştaki eğik çizgiden ve sondaki
 * kopya numarasından arındırılıyor — `passbolt-passbolt-1` bir servis adı
 * değil, compose'un ÜRETTİĞİ container adı.
 */
export function serviceNameFrom(containerName: string): string {
  const temiz = containerName
    .replace(/^\//, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return temiz || "servis";
}

/* -------------------------------------------------------------------------- */
/* Parçalar                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * `HostConfig.PortBindings` → compose `ports` listesi.
 *
 * Adres KORUNUYOR: `127.0.0.1:8080:80` ile `8080:80` arasındaki fark, servisin
 * yalnızca yerelden mi yoksa tüm dünyadan mı erişilebilir olduğu. Bu ayrımı
 * düşürmek, kapalı bir portu sessizce açmak olurdu.
 */
function portList(bindings: Record<string, unknown>): string[] {
  const out: string[] = [];

  for (const [port, raw] of Object.entries(bindings)) {
    const [containerPort, proto = "tcp"] = port.split("/");
    const suffix = proto === "tcp" ? "" : `/${proto}`;

    const hedefler = list(raw);
    if (hedefler.length === 0) continue;

    for (const entry of hedefler) {
      const bind = obj(entry);
      const hostPort = text(bind.HostPort);
      const hostIp = text(bind.HostIp);

      if (!hostPort) {
        // Boş HostPort = rastgele host portu. Compose'da tek başına container
        // portu yazmak aynı anlama geliyor.
        out.push(`${containerPort}${suffix}`);
        continue;
      }

      const adres = hostIp && hostIp !== "0.0.0.0" && hostIp !== "::" ? `${hostIp}:` : "";
      out.push(`${adres}${hostPort}:${containerPort}${suffix}`);
    }
  }

  return out;
}

type MountInfo = { entries: string[]; named: string[]; warnings: string[] };

/**
 * `Mounts` → compose `volumes` listesi ve üst düzey volume adları.
 *
 * `HostConfig.Binds` yerine `Mounts` kullanılıyor: ikincisi named volume ile
 * bind mount'u ayırt ediyor ve salt-okunurluğu ayrı bir alanda taşıyor.
 */
function mountList(mounts: unknown[]): MountInfo {
  const entries: string[] = [];
  const named: string[] = [];
  const warnings: string[] = [];

  for (const raw of mounts) {
    const mount = obj(raw);
    const type = text(mount.Type);
    const destination = text(mount.Destination);
    if (!destination) continue;

    const readonly = mount.RW === false ? ":ro" : "";

    if (type === "bind") {
      const source = text(mount.Source);
      if (!source) continue;
      entries.push(`${source}:${destination}${readonly}`);
      continue;
    }

    if (type === "volume") {
      const name = text(mount.Name);
      if (!name) {
        entries.push(destination);
        continue;
      }
      entries.push(`${name}:${destination}${readonly}`);
      named.push(name);

      // Anonim volume: Docker'ın verdiği 64 haneli onaltılık ad. Adıyla
      // referans vermek VERİYİ KORUYOR (yeni bir boş volume yaratmaktansa),
      // ama bu adın okunur bir tarafı yok ve kullanıcı bunu bilmeli.
      if (/^[0-9a-f]{64}$/.test(name)) {
        warnings.push(
          `${destination} anonim bir volume'de (${name.slice(0, 12)}…). ` +
            "Veri korunsun diye adıyla yazıldı; okunur bir ada taşımak istersen " +
            "önce içeriği kopyalaman gerekir.",
        );
      }
      continue;
    }

    if (type === "tmpfs") {
      // tmpfs `Mounts`ta da görünüyor ama compose'da ayrı bir anahtar;
      // aşağıda HostConfig.Tmpfs'ten yazılıyor.
      continue;
    }

    warnings.push(`${destination} bağlantısı "${type}" türünde — taşınmadı.`);
  }

  return { entries, named, warnings };
}

/* -------------------------------------------------------------------------- */
/* Üretici                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Ham container inspect + ham image inspect → compose metni.
 *
 * @param rawContainer `GET /containers/{id}/json` çıktısı.
 * @param rawImage     Container'ın imajının `GET /images/{id}/json` çıktısı;
 *                     yoksa `null` — o zaman gürültü ayıklaması yapılamaz ve
 *                     bunu uyarı olarak söylüyoruz.
 */
export function generateCompose(
  rawContainer: unknown,
  rawImage: unknown,
  options: GenerateOptions,
): GenerateResult {
  const container = obj(rawContainer);
  const config = obj(container.Config);
  const hostConfig = obj(container.HostConfig);
  const imageConfig = obj(obj(rawImage).Config);

  const warnings: string[] = [];
  if (!rawImage) {
    warnings.push(
      "İmajın yapılandırması okunamadı; imajdan gelen ortam değişkenleri ve " +
        "komutlar ayıklanamadı. Üretilen dosyada gereksiz satırlar olabilir.",
    );
  }

  const containerName = text(container.Name).replace(/^\//, "");
  const serviceName = options.serviceName?.trim() || serviceNameFrom(containerName);

  const service: Record<string, unknown> = {};

  /*
    İmaj referansı: `Config.Image` kullanıcının yazdığı etiket (`nginx:1.24`),
    `Image` ise çözümlenmiş digest. Etiket okunur ve güncellenebilir olduğu için
    o tercih ediliyor; yoksa digest'e düşülüyor ve durum söyleniyor.
  */
  const imageRef = text(config.Image) || text(container.Image);
  service.image = imageRef;
  if (!text(config.Image)) {
    warnings.push("İmaj etiketi bulunamadı, digest yazıldı — güncelleme takibi çalışmaz.");
  }

  /*
    `container_name`: compose normalde `<proje>-<servis>-1` üretir. Adı sabitlemek
    ölçeklemeyi kapatıyor ama bir sunucu panelinde adlar dışarıdan referans
    alınıyor (proxy hedefleri, izleyiciler, betikler) ve adın değişmesi onların
    hepsini bozar.
  */
  if (containerName) service.container_name = containerName;

  const hostname = text(config.Hostname);
  const shortId = text(container.Id).slice(0, 12);
  // Docker hostname'i vermeyene kısa id'yi yazıyor; bu kullanıcının seçimi değil.
  if (hostname && hostname !== shortId && hostname !== containerName) {
    service.hostname = hostname;
  }

  const restart = obj(hostConfig.RestartPolicy);
  const restartName = text(restart.Name);
  if (restartName && restartName !== "no") {
    const retry = Number(restart.MaximumRetryCount ?? 0);
    service.restart =
      restartName === "on-failure" && retry > 0 ? `on-failure:${retry}` : restartName;
  }

  const ports = portList(obj(hostConfig.PortBindings));
  if (ports.length > 0) service.ports = ports;

  /*
    Ortam değişkenleri. `user` kipinde imajın verdikleri düşürülüyor —
    inherit.ts'in güncellemede yaptığı ayrımın aynısı.
  */
  const env =
    options.env === "all"
      ? strings(config.Env)
      : inheritEnv(strings(config.Env), strings(imageConfig.Env));
  if (env.length > 0) {
    service.environment = env;
  }

  const mounts = mountList(list(container.Mounts));
  warnings.push(...mounts.warnings);
  if (mounts.entries.length > 0) service.volumes = mounts.entries;

  const tmpfs = Object.keys(obj(hostConfig.Tmpfs));
  if (tmpfs.length > 0) service.tmpfs = tmpfs;

  /*
    Ağlar. `network_mode` ve `networks` compose'da BİRLİKTE kullanılamaz;
    host/none kipinde ağ listesi zaten anlamsız.
  */
  const networkMode = text(hostConfig.NetworkMode);
  const networkNames = Object.keys(obj(obj(container.NetworkSettings).Networks));
  const externalNetworks: string[] = [];

  if (networkMode === "host" || networkMode === "none") {
    service.network_mode = networkMode;
  } else if (networkMode.startsWith("container:")) {
    service.network_mode = networkMode;
    warnings.push(
      "Ağ kipi başka bir container'a bağlı (`" +
        networkMode +
        "`). Compose'da bu ancak hedef container aynı dosyada tanımlıysa " +
        "çalışır — kontrol etmen gerekiyor.",
    );
  } else {
    // `bridge` Docker'ın varsayılanı; yazmak bilgi taşımıyor. Adlandırılmış
    // ağlar ise dışarıda zaten var, `external: true` ile bağlanılıyor.
    const özel = networkNames.filter((name) => name !== "bridge");
    if (özel.length > 0) {
      service.networks = özel;
      externalNetworks.push(...özel);
    }
  }

  /*
    Komut ve giriş noktası: YALNIZCA imajınkinden farklıysa. Aynıysa yazmak,
    imaj güncellendiğinde yeni komutun gelmesini engeller.
  */
  if (!same(config.Entrypoint, imageConfig.Entrypoint)) {
    const entrypoint = strings(config.Entrypoint);
    if (entrypoint.length > 0) service.entrypoint = entrypoint;
  }
  if (!same(config.Cmd, imageConfig.Cmd)) {
    const cmd = strings(config.Cmd);
    if (cmd.length > 0) service.command = cmd;
  }

  const user = text(config.User);
  if (user && user !== text(imageConfig.User)) service.user = user;

  const workingDir = text(config.WorkingDir);
  if (workingDir && workingDir !== text(imageConfig.WorkingDir)) service.working_dir = workingDir;

  const capAdd = strings(hostConfig.CapAdd);
  if (capAdd.length > 0) service.cap_add = capAdd;
  const capDrop = strings(hostConfig.CapDrop);
  if (capDrop.length > 0) service.cap_drop = capDrop;

  if (hostConfig.Privileged === true) service.privileged = true;

  const devices = list(hostConfig.Devices)
    .map((raw) => {
      const device = obj(raw);
      const host = text(device.PathOnHost);
      const inside = text(device.PathInContainer);
      const perms = text(device.CgroupPermissions);
      if (!host || !inside) return null;
      return perms && perms !== "rwm" ? `${host}:${inside}:${perms}` : `${host}:${inside}`;
    })
    .filter((entry): entry is string => entry !== null);
  if (devices.length > 0) service.devices = devices;

  const securityOpt = strings(hostConfig.SecurityOpt);
  if (securityOpt.length > 0) service.security_opt = securityOpt;

  const extraHosts = strings(hostConfig.ExtraHosts);
  if (extraHosts.length > 0) service.extra_hosts = extraHosts;

  const dns = strings(hostConfig.Dns);
  if (dns.length > 0) service.dns = dns;

  const sysctls = obj(hostConfig.Sysctls);
  if (Object.keys(sysctls).length > 0) service.sysctls = sysctls;

  const shmSize = Number(hostConfig.ShmSize ?? 0);
  // 64 MB Docker'ın varsayılanı; yazmak bilgi taşımıyor.
  if (Number.isFinite(shmSize) && shmSize > 0 && shmSize !== 67108864) {
    service.shm_size = shmSize;
  }

  const memory = Number(hostConfig.Memory ?? 0);
  if (Number.isFinite(memory) && memory > 0) service.mem_limit = memory;

  const nanoCpus = Number(hostConfig.NanoCpus ?? 0);
  if (Number.isFinite(nanoCpus) && nanoCpus > 0) service.cpus = nanoCpus / 1e9;

  /*
    Healthcheck: imajınkinden farklıysa. `Test: ["NONE"]` özel bir değer —
    "imajın healthcheck'ini kapat" demek ve compose karşılığı `disable: true`.
  */
  const health = obj(config.Healthcheck);
  const imageHealth = obj(imageConfig.Healthcheck);
  if (Object.keys(health).length > 0 && !same(health, imageHealth)) {
    const test = strings(health.Test);
    if (test.length === 1 && test[0] === "NONE") {
      service.healthcheck = { disable: true };
    } else if (test.length > 0) {
      const hc: Record<string, unknown> = { test };
      // Docker nanosaniye tutuyor; compose süre dizesi bekliyor.
      const süre = (value: unknown) => {
        const ns = Number(value ?? 0);
        return Number.isFinite(ns) && ns > 0 ? `${Math.round(ns / 1e9)}s` : null;
      };
      const interval = süre(health.Interval);
      if (interval) hc.interval = interval;
      const timeout = süre(health.Timeout);
      if (timeout) hc.timeout = timeout;
      const startPeriod = süre(health.StartPeriod);
      if (startPeriod) hc.start_period = startPeriod;
      const retries = Number(health.Retries ?? 0);
      if (Number.isFinite(retries) && retries > 0) hc.retries = retries;
      service.healthcheck = hc;
    }
  }

  /*
    Etiketler. İmajdan gelenler düşüyor (inherit.ts'in kuralı) ve
    `com.docker.compose.*` de düşüyor — burada inherit.ts'ten AYRILIYORUZ:
    orada korunmaları gerekiyordu, burada onları yazmak container'ı var olmayan
    bir projeye ait göstermek olurdu. Compose bu etiketleri kendi yazar.
  */
  const imageLabels = obj(imageConfig.Labels);
  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj(config.Labels))) {
    if (key.startsWith("com.docker.compose.")) continue;
    if (key.startsWith("desktop.docker.io/")) continue;
    if (imageLabels[key] === value) continue;
    labels[key] = String(value);
  }
  if (Object.keys(labels).length > 0) service.labels = labels;

  const logging = obj(hostConfig.LogConfig);
  const logType = text(logging.Type);
  const logOptions = obj(logging.Config);
  if (logType && logType !== "json-file") {
    service.logging = { driver: logType, ...(Object.keys(logOptions).length > 0 ? { options: logOptions } : {}) };
  } else if (Object.keys(logOptions).length > 0) {
    service.logging = { driver: "json-file", options: logOptions };
  }

  const links = strings(hostConfig.Links);
  if (links.length > 0) {
    warnings.push(
      "Container eski usul `--link` kullanıyor. Compose'da bunun karşılığı yok; " +
        "servisler aynı ağdayken adlarıyla birbirini bulur.",
    );
  }

  /* --- Üst düzey --- */

  const root: Record<string, unknown> = { services: { [serviceName]: service } };

  /*
    `external: true`: bu volume ve ağlar ZATEN VAR. Dışsal işaretlemeden
    bırakmak compose'un `<proje>_<ad>` önekiyle YENİLERİNİ yaratması demek —
    yani container aynı isimde ama bomboş bir volume ile açılırdı.
  */
  if (mounts.named.length > 0) {
    root.volumes = Object.fromEntries(mounts.named.map((name) => [name, { external: true }]));
  }
  if (externalNetworks.length > 0) {
    root.networks = Object.fromEntries(
      externalNetworks.map((name) => [name, { external: true }]),
    );
  }

  const doc = new Document(root);
  doc.commentBefore =
    ` ${containerName || serviceName} container'ından üretildi (panel).\n` +
    " Kaydetmeden önce gözden geçir: gizli değerler ortam değişkenlerinde açık\n" +
    " yazılmış olabilir ve dosya diske bu hâliyle yazılır.";

  return { yaml: doc.toString({ lineWidth: 0 }), serviceName, warnings };
}
