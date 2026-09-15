/**
 * Compose belgesinde tek bir servisin okunması ve düzenlenmesi (M3.19).
 *
 * I/O yok. `yaml` paketinin **Document** API'si kullanılıyor, `parse`/`stringify`
 * ikilisi DEĞİL: ikincisi belgeyi düz nesneye çevirip yeniden üretir ve bu
 * sırada YORUMLAR, anahtar sırası ve tırnak biçimi kaybolur. Kullanıcının elle
 * yazdığı bir compose dosyasını, tek bir portu değiştirmek için baştan aşağı
 * yeniden biçimlendirmek kabul edilebilir bir davranış değil.
 *
 * Düzenleme bu yüzden DÜĞÜM YERİNDE yapılıyor: var olan bir skaler düğümün
 * yalnızca `value`'su değişiyor, düğümün kendisi (ve ona iliştirilmiş yorum)
 * ayakta kalıyor.
 */

import {
  Document,
  isMap,
  isNode,
  isScalar,
  isSeq,
  parseDocument,
  type YAMLMap,
  type YAMLSeq,
} from "yaml";

import { formatPortSpec, parsePortSpec, type PortSpec } from "./ports.ts";

export type ServiceConfig = {
  name: string;
  image: string;
  ports: PortSpec[];
  networks: string[];
  /** Tanımlı değilse boş dize — compose'un varsayılanı "no". */
  restart: string;
  /** Bind ve named volume tanımları, ham hâlleriyle. */
  volumes: string[];
  environment: { key: string; value: string }[];
};

export type ParsedCompose = {
  doc: Document | null;
  error: string | null;
};

export function parseCompose(text: string): ParsedCompose {
  let doc: Document;
  try {
    doc = parseDocument(text, { keepSourceTokens: false });
  } catch (error) {
    return { doc: null, error: error instanceof Error ? error.message : "YAML okunamadı" };
  }

  // `parseDocument` fırlatmak yerine hataları toplar; ilki yeter.
  if (doc.errors.length > 0) return { doc: null, error: doc.errors[0].message };
  if (!isMap(doc.contents)) return { doc: null, error: "Compose dosyası bir eşleme değil." };

  return { doc, error: null };
}

function servicesMap(doc: Document): YAMLMap | null {
  const services = doc.getIn(["services"], true);
  return isMap(services) ? services : null;
}

export function serviceNames(doc: Document): string[] {
  const services = servicesMap(doc);
  if (!services) return [];
  return services.items
    .map((item) => (isScalar(item.key) ? String(item.key.value) : null))
    .filter((name): name is string => name !== null && name.length > 0);
}

function serviceMap(doc: Document, name: string): YAMLMap | null {
  const service = doc.getIn(["services", name], true);
  return isMap(service) ? service : null;
}

/** Bir dizi düğümünü düz JS değerlerine indirger; dizi değilse boş döner. */
function seqValues(node: unknown): unknown[] {
  if (!isSeq(node)) return [];
  return (node as YAMLSeq).items.map((item) => {
    if (isScalar(item)) return item.value;
    // Uzun biçimli port ya da iç içe yapı: düz JS karşılığına indir.
    if (isNode(item)) return item.toJSON();
    return item;
  });
}

/**
 * `environment` iki biçimde yazılabiliyor: eşleme (`KEY: value`) ya da dizi
 * (`- KEY=value`). İkisi de okunuyor; hangisi olduğu yazma tarafında önemli.
 */
function readEnvironment(service: YAMLMap): { key: string; value: string }[] {
  const node = service.get("environment", true);

  if (isMap(node)) {
    return (node as YAMLMap).items.map((item) => ({
      key: isScalar(item.key) ? String(item.key.value) : "",
      value: isScalar(item.value) ? String(item.value.value ?? "") : "",
    }));
  }

  if (isSeq(node)) {
    return seqValues(node).map((entry) => {
      const text = String(entry ?? "");
      const eq = text.indexOf("=");
      return eq === -1
        ? { key: text, value: "" }
        : { key: text.slice(0, eq), value: text.slice(eq + 1) };
    });
  }

  return [];
}

/**
 * `networks` da iki biçimde yazılabiliyor ve ikincisi kolayca gözden kaçıyor:
 *
 *     networks: [arka]          # dizi — yalnızca adlar
 *     networks:                 # eşleme — ada ek ayar iliştirilmiş
 *       arka:
 *         aliases: [db]
 *
 * Yalnızca diziyi okuyan bir sürüm, ikinci biçimde yazılmış bir servisi
 * "hiçbir ağa bağlı değil" sanıyordu; kullanıcı başka bir alanı kaydettiğinde
 * `setServiceNetworks(doc, name, [])` çağrılıyor ve `aliases` ile sabit IP'ler
 * SESSİZCE siliniyordu. Burası o hatanın kapandığı yer.
 */
function networkNames(node: unknown): string[] {
  if (isMap(node)) {
    return (node as YAMLMap).items
      .map((item) => (isScalar(item.key) ? String(item.key.value) : ""))
      .filter((name) => name.length > 0);
  }
  if (isSeq(node)) {
    return seqValues(node)
      .map((entry) => String(entry ?? ""))
      .filter((name) => name.length > 0);
  }
  return [];
}

/**
 * `network_mode` değeri; tanımsızsa boş dize.
 *
 * Compose'da `network_mode` ile `networks` BİR ARADA KULLANILAMAZ. Arayüzün
 * ağ bölümünü kilitlemesi ve yazma tarafının reddetmesi buna dayanıyor.
 */
export function networkMode(doc: Document, name: string): string {
  const service = serviceMap(doc, name);
  if (!service) return "";
  const value = service.get("network_mode");
  return value === undefined || value === null ? "" : String(value);
}

export function readService(doc: Document, name: string): ServiceConfig | null {
  const service = serviceMap(doc, name);
  if (!service) return null;

  const image = service.get("image");
  const restart = service.get("restart");

  return {
    name,
    image: image === undefined || image === null ? "" : String(image),
    ports: seqValues(service.get("ports", true)).map(parsePortSpec),
    networks: networkNames(service.get("networks", true)),
    restart: restart === undefined || restart === null ? "" : String(restart),
    volumes: seqValues(service.get("volumes", true)).map((entry) =>
      typeof entry === "string" ? entry : JSON.stringify(entry),
    ),
    environment: readEnvironment(service),
  };
}

export function readAllServices(doc: Document): ServiceConfig[] {
  return serviceNames(doc)
    .map((name) => readService(doc, name))
    .filter((entry): entry is ServiceConfig => entry !== null);
}

/**
 * Servisin portlarını yazar.
 *
 * Var olan düğümler YERİNDE güncelleniyor (yorumları korumak için); yalnızca
 * biçim değiştiyse ya da yeni satır ekleniyorsa düğüm yaratılıyor. Liste
 * boşaldığında `ports: []` bırakılmıyor, anahtar tamamen kaldırılıyor — boş bir
 * dizi, kullanıcının yazmadığı bir şeyi dosyaya eklemek olurdu.
 */
export function setServicePorts(doc: Document, name: string, specs: PortSpec[]): void {
  const service = serviceMap(doc, name);
  if (!service) throw new Error(`servis bulunamadı: ${name}`);

  if (specs.length === 0) {
    service.delete("ports");
    return;
  }

  const existing = service.get("ports", true);
  if (!isSeq(existing)) {
    service.set("ports", doc.createNode(specs.map(formatPortSpec)));
    return;
  }

  const seq = existing as YAMLSeq;
  for (let index = 0; index < specs.length; index += 1) {
    const value = formatPortSpec(specs[index]);
    const node = seq.items[index];

    if (node === undefined) {
      seq.items.push(doc.createNode(value));
      continue;
    }
    // Skaler → skaler: yalnızca değer değişir, düğüm ve yorumu yerinde kalır.
    if (isScalar(node) && typeof value === "string") {
      node.value = value;
      continue;
    }
    if (isMap(node) && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) (node as YAMLMap).set(key, entry);
      continue;
    }
    seq.items[index] = doc.createNode(value);
  }

  seq.items.length = specs.length;
}

export function setServiceRestart(doc: Document, name: string, policy: string): void {
  const service = serviceMap(doc, name);
  if (!service) throw new Error(`servis bulunamadı: ${name}`);

  if (!policy) service.delete("restart");
  else service.set("restart", policy);
}

/**
 * Servisin ağlarını yazar ve gerekiyorsa üst düzey `networks:` bloğuna kayıt
 * düşer.
 *
 * Compose, bir serviste adı geçen ama üst düzeyde tanımlanmayan ağ için
 * `config` aşamasında hata verir. Kullanıcıyı o hatayla baş başa bırakmak
 * yerine eksik kaydı panel açıyor — ama YALNIZCA eksikse: var olan bir ağ
 * tanımının (driver, external, ipam) üzerine yazmıyor.
 */
export function setServiceNetworks(doc: Document, name: string, networks: string[]): void {
  const service = serviceMap(doc, name);
  if (!service) throw new Error(`servis bulunamadı: ${name}`);

  const mode = networkMode(doc, name);
  if (mode) {
    throw new Error(
      `${name} servisi network_mode: ${mode} kullanıyor; compose'da network_mode ile ` +
        "networks bir arada kullanılamaz. Önce network_mode satırını kaldır.",
    );
  }

  const existing = service.get("networks", true);

  if (networks.length === 0) {
    service.delete("networks");
  } else if (isMap(existing)) {
    // EŞLEME BİÇİMİ KORUNUYOR. Kalan anahtarların DEĞERLERİNE dokunulmuyor;
    // `aliases`, `ipv4_address`, `priority` gibi ayarlar bu sayede hayatta
    // kalıyor. Diziye çevirmek onları çöpe atmak olurdu.
    const map = existing as YAMLMap;
    const istenen = new Set(networks);

    for (const item of [...map.items]) {
      const key = isScalar(item.key) ? String(item.key.value) : "";
      if (!istenen.has(key)) map.delete(item.key);
    }
    for (const network of networks) {
      if (!map.has(network)) map.set(network, doc.createNode({}));
    }
  } else if (isSeq(existing)) {
    // Dizi de yerinde güncelleniyor: satırlara iliştirilmiş yorumlar kalsın.
    const seq = existing as YAMLSeq;
    for (let index = 0; index < networks.length; index += 1) {
      const node = seq.items[index];
      if (isScalar(node)) node.value = networks[index];
      else seq.items[index] = doc.createNode(networks[index]);
    }
    seq.items.length = networks.length;
  } else {
    service.set("networks", doc.createNode(networks));
  }

  if (networks.length === 0) return;

  let top = doc.getIn(["networks"], true);
  if (!isMap(top)) {
    doc.setIn(["networks"], doc.createNode({}));
    top = doc.getIn(["networks"], true);
  }
  if (!isMap(top)) return;

  for (const network of networks) {
    if ((top as YAMLMap).has(network)) continue;
    // Boş eşleme = "varsayılanlarla oluştur" (sürücü bridge olur). Değer olarak
    // ham `null` verilince yaml açık anahtar biçimini (`? agim`) üretiyor; bu
    // geçerli YAML ama compose dosyalarında kimsenin yazmadığı bir gösterim ve
    // kullanıcının diff'ini gereksiz yere yabancılaştırır.
    (top as YAMLMap).set(network, doc.createNode({}));
  }
}

/**
 * Servisin ortam değişkenlerini yazar (M3.21).
 *
 * Portlarla aynı kural: GİRDİDEKİ BİÇİM KORUNUR. Eşleme yazılmış bir bloğu
 * `- KEY=value` dizisine çevirmek dosyanın yarısını diff'e sokardı ve
 * kullanıcının tercih ettiği yazımı panelin tercihine göre değiştirmek olurdu.
 *
 * `${DEĞİŞKEN}` referansları düz metin olarak taşınıyor, ÇÖZÜLMÜYOR: çözmek,
 * `.env` dosyasındaki bir sırrı compose dosyasına kalıcı olarak yazmak
 * anlamına gelirdi.
 */
export function setServiceEnvironment(
  doc: Document,
  name: string,
  entries: { key: string; value: string }[],
): void {
  const service = serviceMap(doc, name);
  if (!service) throw new Error(`servis bulunamadı: ${name}`);

  const temiz = entries.filter((entry) => entry.key.trim().length > 0);

  if (temiz.length === 0) {
    service.delete("environment");
    return;
  }

  const existing = service.get("environment", true);

  if (isMap(existing)) {
    const map = existing as YAMLMap;
    const istenen = new Set(temiz.map((entry) => entry.key));

    for (const item of [...map.items]) {
      const key = isScalar(item.key) ? String(item.key.value) : "";
      if (!istenen.has(key)) map.delete(item.key);
    }
    for (const entry of temiz) {
      const node = map.get(entry.key, true);
      // Skaler yerinde güncellenirse anahtarın yorumu ve tırnak biçimi kalır.
      if (isScalar(node)) node.value = entry.value;
      else map.set(entry.key, entry.value);
    }
    return;
  }

  const satirlar = temiz.map((entry) => `${entry.key}=${entry.value}`);

  if (isSeq(existing)) {
    const seq = existing as YAMLSeq;
    for (let index = 0; index < satirlar.length; index += 1) {
      const node = seq.items[index];
      if (isScalar(node)) node.value = satirlar[index];
      else seq.items[index] = doc.createNode(satirlar[index]);
    }
    seq.items.length = satirlar.length;
    return;
  }

  // Hiç yoksa eşleme biçiminde yaratılıyor: `KEY: value` okunması en kolay
  // yazım ve compose belgelerinin de örneklerde kullandığı biçim.
  service.set(
    "environment",
    doc.createNode(Object.fromEntries(temiz.map((entry) => [entry.key, entry.value]))),
  );
}

/** Belgeyi metne çevirir. Girdideki biçim ve yorumlar korunur. */
export function stringifyCompose(doc: Document): string {
  return doc.toString({ lineWidth: 0 });
}
