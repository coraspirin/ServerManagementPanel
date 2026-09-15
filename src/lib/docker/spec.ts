/**
 * Panel seviyesinde container tanımı ve kaynaklarından türetilmesi (M3.46).
 *
 * ## Neden ayrı bir tip
 *
 * Docker Engine'in `/containers/create` gövdesi kullanıcıya gösterilebilecek
 * bir şey değil: `HostConfig.PortBindings` iç içe bir eşleme, `Env` "K=V"
 * dizisi, `Cmd` ile `Entrypoint` ayrımı kullanıcıya hiçbir şey anlatmıyor.
 * `ContainerSpec` formun gerçekten düzenlediği şey; Engine gövdesi ondan
 * ÜRETİLİYOR ve tek yönlü.
 *
 * ## Neden burada I/O yok
 *
 * Aynı dönüşümler iki yerde gerekiyor: tarayıcıda (YAML'dan ya da image
 * yapılandırmasından formu doldurmak) ve sunucuda (formu Engine gövdesine
 * çevirmek). `server-only` yok, `@/` yolu yok — `node --test` altında
 * doğrudan çalışsın ve istemci paketine sızacak bir bağımlılık taşımasın diye.
 */

import type { ServiceConfig } from "../compose/service.ts";

export type PortMapping = {
  /** Host'ta yayınlanan port; boşsa port yalnızca container içinde açık. */
  hostPort: string;
  /** Belirli bir arayüze bağlıysa ("127.0.0.1"); yoksa boş. */
  hostIp: string;
  containerPort: string;
  protocol: "tcp" | "udp";
};

export type VolumeMount = {
  /** Host yolu ya da named volume adı. */
  source: string;
  /** Container içindeki yol. */
  target: string;
  readOnly: boolean;
};

export type KeyValue = { key: string; value: string };

export type RestartPolicyName = "no" | "always" | "unless-stopped" | "on-failure";

export const RESTART_POLICIES: { value: RestartPolicyName; label: string }[] = [
  { value: "unless-stopped", label: "Elle durdurulana kadar (unless-stopped)" },
  { value: "always", label: "Her zaman (always)" },
  { value: "on-failure", label: "Hata olursa (on-failure)" },
  { value: "no", label: "Yeniden başlatma (no)" },
];

export type ContainerSpec = {
  name: string;
  image: string;
  /** Boşsa imajın kendi `Cmd`'si kullanılır. */
  command: string;
  /** Boşsa imajın kendi `Entrypoint`'i kullanılır. */
  entrypoint: string;
  restart: RestartPolicyName;
  ports: PortMapping[];
  volumes: VolumeMount[];
  env: KeyValue[];
  labels: KeyValue[];
  networks: string[];
  user: string;
  workingDir: string;
  hostname: string;
  /**
   * Ayrıcalıklı mod.
   *
   * Formda var çünkü bazı imajlar (ör. donanıma erişen ev otomasyonu
   * eklentileri) onsuz çalışmıyor ve seçenek yoksa kullanıcı paneli bırakıp
   * SSH'a gidiyor. Varsayılan KAPALI ve arayüz bunun ne demek olduğunu
   * söylüyor: ayrıcalıklı bir container host'ta root'a eşdeğerdir.
   */
  privileged: boolean;
  /** Oluşturulduktan hemen sonra başlatılsın mı. */
  autoStart: boolean;
};

export function emptySpec(): ContainerSpec {
  return {
    name: "",
    image: "",
    command: "",
    entrypoint: "",
    restart: "unless-stopped",
    ports: [],
    volumes: [],
    env: [],
    labels: [],
    networks: [],
    user: "",
    workingDir: "",
    hostname: "",
    privileged: false,
    autoStart: true,
  };
}

/** Container adı için Docker'ın kabul ettiği desen. */
export const CONTAINER_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

/**
 * Formu göndermeye hazır mı — engel varsa neden.
 *
 * Sunucu da aynı işlevi çağırıyor: istemcide kontrol etmek kullanıcıya hızlı
 * geri bildirim için, sunucuda kontrol etmek doğruluk için. İkisini ayrı
 * yazmak, birinin diğerinden ayrışması demekti.
 */
export function specProblem(spec: ContainerSpec): string | null {
  if (!spec.name.trim()) return "Container adı gerekli.";
  if (!CONTAINER_NAME_RE.test(spec.name.trim())) {
    return "Container adı harf ya da rakamla başlamalı; harf, rakam, nokta, tire ve alt çizgi içerebilir.";
  }
  if (!spec.image.trim()) return "Image gerekli.";

  for (const port of spec.ports) {
    const target = port.containerPort.trim();
    if (!/^\d{1,5}$/.test(target) || Number(target) < 1 || Number(target) > 65535) {
      return `Geçersiz container portu: "${port.containerPort}"`;
    }
    const host = port.hostPort.trim();
    if (host && (!/^\d{1,5}$/.test(host) || Number(host) < 1 || Number(host) > 65535)) {
      return `Geçersiz host portu: "${port.hostPort}"`;
    }
  }

  for (const mount of spec.volumes) {
    if (!mount.source.trim() || !mount.target.trim()) {
      return "Her volume satırında hem kaynak hem hedef dolu olmalı.";
    }
    if (!mount.target.trim().startsWith("/")) {
      return `Container içindeki yol mutlak olmalı: "${mount.target}"`;
    }
  }

  for (const entry of spec.env) {
    if (entry.key.trim() && /[\s=]/.test(entry.key.trim())) {
      return `Ortam değişkeni adı boşluk ya da "=" içeremez: "${entry.key}"`;
    }
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Engine gövdesi                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Komut satırını argümanlara böler.
 *
 * Tam bir kabuk ayrıştırıcısı DEĞİL ve olmamalı: `docker run` de komutu kabuğa
 * vermez, argüman dizisi olarak geçirir. Tırnak içindeki boşluklar korunuyor
 * çünkü `--message "iki kelime"` yaygın; gerisi (boru, yönlendirme, değişken
 * genişletme) zaten container içinde bir kabuk olmadan çalışmaz ve burada
 * desteklenmiş gibi görünmesi yanıltıcı olurdu.
 */
export function splitCommand(input: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let started = false;

  for (const char of input.trim()) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started || current) out.push(current);
      current = "";
      started = false;
      continue;
    }
    current += char;
  }

  if (started || current) out.push(current);
  return out;
}

function restartPolicy(spec: ContainerSpec): { Name: string; MaximumRetryCount?: number } {
  // `on-failure` sayı almazsa Docker sonsuz denemeyi kabul ediyor ama pratikte
  // sürekli yeniden başlayan bir container sunucuyu meşgul ediyor; 5 deneme
  // `docker run --restart on-failure:5` ile aynı yaygın seçim.
  return spec.restart === "on-failure"
    ? { Name: "on-failure", MaximumRetryCount: 5 }
    : { Name: spec.restart };
}

function pairsToRecord(pairs: KeyValue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of pairs) {
    const key = pair.key.trim();
    if (key) out[key] = pair.value;
  }
  return out;
}

/**
 * `ContainerSpec` → Docker Engine `/containers/create` gövdesi.
 *
 * Boş alanlar gövdeye HİÇ yazılmıyor, boş dize olarak da yazılmıyor: `Cmd: []`
 * imajın kendi komutunu EZER ve container hiçbir şey çalıştırmadan çıkar.
 * Aynı tuzak `Entrypoint`, `User` ve `WorkingDir` için de geçerli — panelin
 * bu alanları "dokunulmadı" ile "boşaltıldı" arasında ayırması şart.
 */
export function toCreatePayload(spec: ContainerSpec): Record<string, unknown> {
  const exposed: Record<string, Record<string, never>> = {};
  const bindings: Record<string, { HostIp?: string; HostPort: string }[]> = {};

  for (const port of spec.ports) {
    const key = `${port.containerPort.trim()}/${port.protocol}`;
    exposed[key] = {};
    const host = port.hostPort.trim();
    if (!host) continue;
    // Aynı container portu birden çok host portuna bağlanabiliyor.
    (bindings[key] ??= []).push({
      ...(port.hostIp.trim() ? { HostIp: port.hostIp.trim() } : {}),
      HostPort: host,
    });
  }

  const binds = spec.volumes.map(
    (mount) =>
      `${mount.source.trim()}:${mount.target.trim()}${mount.readOnly ? ":ro" : ""}`,
  );

  const env = spec.env
    .filter((entry) => entry.key.trim())
    .map((entry) => `${entry.key.trim()}=${entry.value}`);

  const command = splitCommand(spec.command);
  const entrypoint = splitCommand(spec.entrypoint);

  // İlk ağ NetworkMode olarak veriliyor; kalanlar oluşturmadan SONRA
  // bağlanıyor (Engine tek çağrıda yalnızca birini kabul ediyor).
  const primaryNetwork = spec.networks[0] ?? "";

  return {
    Image: spec.image.trim(),
    ...(command.length > 0 ? { Cmd: command } : {}),
    ...(entrypoint.length > 0 ? { Entrypoint: entrypoint } : {}),
    ...(env.length > 0 ? { Env: env } : {}),
    ...(spec.user.trim() ? { User: spec.user.trim() } : {}),
    ...(spec.workingDir.trim() ? { WorkingDir: spec.workingDir.trim() } : {}),
    ...(spec.hostname.trim() ? { Hostname: spec.hostname.trim() } : {}),
    ...(Object.keys(exposed).length > 0 ? { ExposedPorts: exposed } : {}),
    Labels: pairsToRecord(spec.labels),
    HostConfig: {
      ...(binds.length > 0 ? { Binds: binds } : {}),
      ...(Object.keys(bindings).length > 0 ? { PortBindings: bindings } : {}),
      RestartPolicy: restartPolicy(spec),
      ...(spec.privileged ? { Privileged: true } : {}),
      ...(primaryNetwork ? { NetworkMode: primaryNetwork } : {}),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Compose servisinden                                                         */
/* -------------------------------------------------------------------------- */

/** `"/veri:/data:ro"` gibi bir compose volume satırını ayrıştırır. */
function parseVolumeLine(line: string): VolumeMount | null {
  const parts = line.split(":");
  if (parts.length < 2) {
    // Yalnızca hedef verilmiş ("- /data"): anonim volume. Kaynak olmadan
    // Engine'e Bind veremeyiz; kullanıcının bir ad girmesi gerekiyor.
    return null;
  }

  // Windows yolları burada beklenmiyor; host Linux.
  const readOnly = parts[parts.length - 1] === "ro";
  const trimmed = readOnly ? parts.slice(0, -1) : parts;
  if (trimmed.length < 2) return null;

  return {
    source: trimmed.slice(0, trimmed.length - 1).join(":"),
    target: trimmed[trimmed.length - 1],
    readOnly,
  };
}

function normalizeRestart(value: string): RestartPolicyName {
  const known = RESTART_POLICIES.map((entry) => entry.value);
  // `on-failure:5` gibi sayılı biçim compose'da geçerli; sayıyı düşürüyoruz.
  const base = value.split(":")[0].trim();
  return (known as string[]).includes(base) ? (base as RestartPolicyName) : "unless-stopped";
}

/**
 * Compose servisinden container tanımı.
 *
 * Ayrıştırılamamış (`raw` dolu) port tanımları DÜŞÜYOR ve çağıran bunu
 * uyarı olarak gösteriyor: `${PORT}:80` ya da `3000-3005:3000-3005` gibi bir
 * satırı tek bir container'a çevirmek ya değişkeni çözmeyi ya da aralığı
 * açmayı gerektirir. Sessizce yanlış bir port açmaktansa söylemek doğru.
 */
export function specFromService(
  service: ServiceConfig,
  containerName?: string,
): { spec: ContainerSpec; warnings: string[] } {
  const warnings: string[] = [];
  const spec = emptySpec();

  spec.name = (containerName ?? service.name).trim();
  spec.image = service.image;
  spec.restart = service.restart ? normalizeRestart(service.restart) : "unless-stopped";
  spec.networks = [...service.networks];
  spec.env = service.environment.map((entry) => ({ key: entry.key, value: entry.value }));

  for (const port of service.ports) {
    if (port.raw !== null) {
      warnings.push(`Port tanımı çözülemedi ve atlandı: ${port.raw}`);
      continue;
    }
    spec.ports.push({
      hostPort: port.published === null ? "" : String(port.published),
      hostIp: port.hostIp,
      containerPort: String(port.target),
      protocol: port.protocol,
    });
  }

  for (const line of service.volumes) {
    const mount = parseVolumeLine(line);
    if (mount) spec.volumes.push(mount);
    else warnings.push(`Volume tanımı çözülemedi ve atlandı: ${line}`);
  }

  if (!spec.image) warnings.push("Serviste image yok; compose onu build ediyor olabilir.");

  return { spec, warnings };
}

/* -------------------------------------------------------------------------- */
/* Image yapılandırmasından                                                    */
/* -------------------------------------------------------------------------- */

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** `"ghcr.io/kullanici/uygulama:2.1"` → `"uygulama"`. */
export function nameFromImage(reference: string): string {
  const withoutTag = reference.split("@")[0].replace(/:[^:/]+$/, "");
  const last = withoutTag.split("/").pop() ?? "";
  const clean = last.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  return clean;
}

/**
 * Çekilmiş bir imajın kendi yapılandırmasından ön dolgu.
 *
 * `ExposedPorts` container portlarını veriyor ama host portunu VERMİYOR —
 * onu imaj bilemez. Host portu boş bırakılıyor: aynı sayıyı otomatik önermek,
 * sunucuda 8080'i zaten dinleyen bir şey varken sessizce çakışan bir container
 * üretirdi. Kullanıcı hangi portu açacağına kendisi karar veriyor.
 *
 * `Env` imajın varsayılanlarını da içeriyor (`PATH`, `LANG`); bunlar forma
 * yazılıyor çünkü kullanıcının hangi değişkeni değiştirmesi gerektiğini
 * görmesinin başka yolu yok. `PATH` gibi apaçık olanlar eleniyor.
 */
const IMAGE_ENV_NOISE = new Set(["PATH", "HOME", "TERM", "HOSTNAME"]);

export function specFromImage(reference: string, inspect: unknown): ContainerSpec {
  const spec = emptySpec();
  spec.image = reference;
  spec.name = nameFromImage(reference);

  const config = obj(obj(inspect).Config);

  for (const key of Object.keys(obj(config.ExposedPorts))) {
    const [port, protocol = "tcp"] = key.split("/");
    spec.ports.push({
      hostPort: "",
      hostIp: "",
      containerPort: port,
      protocol: protocol === "udp" ? "udp" : "tcp",
    });
  }

  for (const entry of Array.isArray(config.Env) ? config.Env : []) {
    const text = String(entry);
    const eq = text.indexOf("=");
    if (eq === -1) continue;
    const key = text.slice(0, eq);
    if (IMAGE_ENV_NOISE.has(key)) continue;
    spec.env.push({ key, value: text.slice(eq + 1) });
  }

  // İmajın tanımladığı volume'ler hedefi biliyor, kaynağı bilmiyor: named
  // volume adı öneriliyor ki kullanıcı boş bir satırla karşılaşmasın.
  for (const target of Object.keys(obj(config.Volumes))) {
    const suffix = target.split("/").filter(Boolean).pop() ?? "veri";
    spec.volumes.push({
      source: `${spec.name || "container"}-${suffix}`,
      target,
      readOnly: false,
    });
  }

  if (typeof config.WorkingDir === "string") spec.workingDir = config.WorkingDir;
  if (typeof config.User === "string") spec.user = config.User;

  return spec;
}
