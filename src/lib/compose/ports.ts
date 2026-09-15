/**
 * Compose port tanımlarının ayrıştırılması ve geri yazılması (M3.19).
 *
 * Bu dosyada I/O yok. Compose'un port söz dizimi üç ayrı biçimde yazılabiliyor
 * ve üçü de sahada karşımıza çıkıyor:
 *
 *   kısa   : "80", "8080:80", "8080:80/udp", "127.0.0.1:8080:80"
 *   uzun   : { target: 80, published: "8080", protocol: tcp, mode: host }
 *   ham    : "3000-3005:3000-3005", "${PORT}:80"
 *
 * ⚠️ BİÇİM KORUNUR. Kısa yazılmış bir portu uzun biçime çevirmek teknik olarak
 * doğru olurdu ama kullanıcının dosyasını, istemediği bir değişiklikle kirletir
 * ve diff'i okunamaz hâle getirir. Panelin işi portu değiştirmek, dosyayı
 * yeniden biçimlendirmek değil.
 *
 * ⚠️ AYRIŞTIRILAMAYAN OLDUĞU GİBİ TAŞINIR. Port aralıkları ve `${DEĞİŞKEN}`
 * içeren tanımlar `raw` olarak saklanıp aynen geri yazılıyor. Alternatif —
 * anlamadığımız satırı düşürmek — kullanıcının yayınını sessizce kapatırdı.
 */

export type PortSpec = {
  /** Host'ta yayınlanan port; null ise yalnızca container içinde açık. */
  published: number | null;
  /** Container içindeki port. `raw` doluysa anlamsız (0). */
  target: number;
  protocol: "tcp" | "udp";
  /** Belirli bir arayüze bağlıysa ("127.0.0.1"); yoksa boş. */
  hostIp: string;
  /** Girdideki yazım biçimi — geri yazarken bu korunur. */
  form: "short" | "long";
  /**
   * Ayrıştırılamayan tanımın ham hâli.
   *
   * Dolu olduğunda diğer alanlara GÜVENİLMEZ ve panel bu satırı düzenlemeye
   * kapatır: neyi değiştirdiğini bilmediği bir satırı değiştirmemeli.
   */
  raw: string | null;
};

/** Uzun biçimdeki bir port tanımının panelin umursadığı alanları. */
type LongPort = {
  target?: unknown;
  published?: unknown;
  protocol?: unknown;
  host_ip?: unknown;
  mode?: unknown;
};

function unparsed(raw: string): PortSpec {
  return { published: null, target: 0, protocol: "tcp", hostIp: "", form: "short", raw };
}

function port(value: string): number | null {
  if (!/^\d{1,5}$/.test(value)) return null;
  const parsed = Number(value);
  return parsed >= 1 && parsed <= 65535 ? parsed : null;
}

/**
 * Kısa biçim: `[hostIp:][published:]target[/protocol]`
 *
 * İki nokta sayısına göre ayrışıyor ama IPv6 host adresi de iki nokta içerir
 * (`[::1]:8080:80`); bu yüzden köşeli parantezli önek önce kesiliyor.
 */
function parseShort(value: string): PortSpec {
  let rest = value.trim();
  if (!rest) return unparsed(value);

  let hostIp = "";
  const bracketed = rest.match(/^\[([^\]]+)\]:(.*)$/);
  if (bracketed) {
    hostIp = bracketed[1];
    rest = bracketed[2];
  }

  let protocol: "tcp" | "udp" = "tcp";
  const slash = rest.lastIndexOf("/");
  if (slash !== -1) {
    const suffix = rest.slice(slash + 1).toLowerCase();
    if (suffix !== "tcp" && suffix !== "udp") return unparsed(value);
    protocol = suffix;
    rest = rest.slice(0, slash);
  }

  const parts = rest.split(":");

  // Köşeli parantezsiz IPv4 host adresi: "127.0.0.1:8080:80"
  if (!hostIp && parts.length === 3) {
    hostIp = parts.shift() ?? "";
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(hostIp)) return unparsed(value);
  }

  if (parts.length === 1) {
    const target = port(parts[0]);
    if (target === null) return unparsed(value);
    return { published: null, target, protocol, hostIp, form: "short", raw: null };
  }

  if (parts.length === 2) {
    const published = port(parts[0]);
    const target = port(parts[1]);
    if (published === null || target === null) return unparsed(value);
    return { published, target, protocol, hostIp, form: "short", raw: null };
  }

  return unparsed(value);
}

function parseLong(value: LongPort): PortSpec {
  const target = port(String(value.target ?? ""));
  if (target === null) return unparsed(JSON.stringify(value));

  // `published` uzun biçimde sayı da olabilir dize de; ikisi de geçerli.
  const rawPublished = value.published === undefined ? "" : String(value.published);
  const published = rawPublished === "" ? null : port(rawPublished);
  if (rawPublished !== "" && published === null) return unparsed(JSON.stringify(value));

  const protocol = String(value.protocol ?? "tcp").toLowerCase();
  if (protocol !== "tcp" && protocol !== "udp") return unparsed(JSON.stringify(value));

  return {
    published,
    target,
    protocol,
    hostIp: String(value.host_ip ?? ""),
    form: "long",
    raw: null,
  };
}

export function parsePortSpec(value: unknown): PortSpec {
  if (typeof value === "number") return parseShort(String(value));
  if (typeof value === "string") return parseShort(value);
  if (value && typeof value === "object") return parseLong(value as LongPort);
  return unparsed(String(value));
}

/**
 * Ayrıştırılmış tanımı, geldiği biçimde geri yazar.
 *
 * Uzun biçimde `mode` gibi panelin umursamadığı alanlar burada ÜRETİLMEZ —
 * çağıran taraf mevcut düğümü yerinde güncelliyor, bu yüzden dokunulmayan
 * alanlar dosyada olduğu gibi kalıyor.
 */
export function formatPortSpec(spec: PortSpec): string | Record<string, unknown> {
  if (spec.raw !== null) return spec.raw;

  if (spec.form === "long") {
    const out: Record<string, unknown> = { target: spec.target };
    if (spec.published !== null) out.published = String(spec.published);
    if (spec.hostIp) out.host_ip = spec.hostIp;
    if (spec.protocol !== "tcp") out.protocol = spec.protocol;
    return out;
  }

  const ipv6 = spec.hostIp.includes(":");
  const prefix = spec.hostIp ? (ipv6 ? `[${spec.hostIp}]:` : `${spec.hostIp}:`) : "";
  const pair = spec.published === null ? String(spec.target) : `${spec.published}:${spec.target}`;
  const suffix = spec.protocol === "udp" ? "/udp" : "";
  return `${prefix}${pair}${suffix}`;
}

/** Panelin düzenlemesine açık mı — ham taşınan satırlar kapalı. */
export function editable(spec: PortSpec): boolean {
  return spec.raw === null;
}
