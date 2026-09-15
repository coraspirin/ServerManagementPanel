/**
 * Compose dosyasının kurulum öncesi ön kontrolleri (M3.19).
 *
 * I/O yok: belge ve panelin bildiği bağlam veriliyor, bulgular dönüyor.
 *
 * ÜÇ SEVİYE, ve ayrım kasıtlı:
 *
 *   engel  — bu compose bu akışta ÇALIŞMAZ. Kurulum başlatılmaz.
 *   uyarı  — çalışır ama muhtemelen istediğin gibi değil. Onay istenir.
 *   öneri  — tek tıkla düzeltilebilir bir eksik. Hiçbir şeyi engellemez.
 *
 * Panelin başka yerlerdeki duruşuyla aynı: M3.7'de port listesine "tehlikeli"
 * damgası vurulmuyor, M3.18'de güvenlik duvarı değişikliği engellenmiyor onay
 * isteniyor. Burada da kullanıcının ne yaptığını bildiği varsayılıyor; panelin
 * işi gördüğünü söylemek, karar vermek değil.
 *
 * ⚠️ BURADA YAPILMAYAN: tanımsız `${DEĞİŞKEN}` kontrolü. Onun tek doğru
 * kaynağı `docker compose config`'in kendisi — `.env` dosyasını, kabuk
 * ortamını ve varsayılan değer söz dizimini (`${VAR:-varsayılan}`) o biliyor.
 * Panelin ikinci bir tahmin yürütmesi yanlış alarm üretirdi; onun yerine
 * `compose.config`'in stderr'i kullanıcıya gösteriliyor (bkz. edit.ts).
 */

import { isMap, isScalar, type Document, type YAMLMap } from "yaml";

import { readAllServices, serviceNames, type ServiceConfig } from "./service.ts";

export type CheckSeverity = "engel" | "uyari" | "oneri";

export type Finding = {
  severity: CheckSeverity;
  /** İlgili servis; belge geneline ait bulgularda boş. */
  service: string;
  title: string;
  detail: string;
  /**
   * Tek tıkla uygulanabilir düzeltme.
   *
   * Yalnızca "öneri" seviyesinde anlamlı: engel ve uyarılar kullanıcının
   * kararını gerektiriyor, otomatik düzeltilecek şeyler değil.
   */
  fix?: { kind: "restart" | "logging"; label: string };
  /**
   * Bulgunun ait olduğu compose anahtarı — satır numarası bunun üzerinden
   * bulunuyor (M3.34). Belge geneline ait bulgularda tanımsız.
   */
  anchor?: string;
  /**
   * Dosyadaki satır numarası (1'den başlar); hesaplanamadıysa tanımsız.
   *
   * Kırk satırlık bir compose dosyasında "web servisinde restart yok" demek
   * yeterliydi; iki yüz satırlık bir dosyada kullanıcı o satırı aramak
   * zorunda kalıyor. `yaml`'ın Document API'si düğüm konumlarını (`range`)
   * zaten taşıyor — kullanmamak, elimizdeki bilgiyi saklamaktı.
   */
  line?: number;
};

/**
 * Port taramasının bundan eskisi "bayat" sayılır (M3.26).
 *
 * `security.port_scan` işi saatte bir çalışıyor; iki tarama aralığı, verinin
 * güncelliğinden makul ölçüde emin olunabilecek en geniş pencere.
 */
export const TAZE_TARAMA_SANIYE = 2 * 60 * 60;

export type CheckContext = {
  /** Port haritasından (M3.17): host portu → onu tutanın adı. */
  reserved: Map<number, string>;
  /**
   * `reserved` verisinin yaşı, saniye. `null` = tarama hiç yapılmamış.
   *
   * Bu veri ÖNBELLEKTEN geliyor ve saatte bir tazeleniyor. Bir saat önceki
   * ölçüme dayanıp "bu portu şu an X tutuyor" diyerek kullanıcıyı ENGELLEMEK,
   * bilgiye hak ettiğinden fazla güvenmek olur — kullanıcı portu az önce
   * boşaltmış olabilir. Bayat veride bulgu uyarıya düşüyor.
   */
  reservedAgeSeconds: number | null;
  /** Panelin kendi portları — kapatılırsa panele erişilemez (M3.18). */
  panelPorts: number[];
  /**
   * Docker'da var olan ağ adları — `external: true` doğrulaması için.
   *
   * `null` = **"Docker'a sorulamadı, bu kontrolü ATLA."** Boş dizi ile `null`
   * arasındaki fark kritik: boş dizi "hiç ağ yok" demek ve `external` işaretli
   * her ağ için engel üretir. Compose düzenleyicisi bağlamı doldurmayı unuttuğu
   * için, dış ağ kullanan her yığının popup'ı SAHTE bir engel gösteriyordu.
   * Bilinmezliği ayrı bir değerle temsil etmek, o hatanın bir daha sessizce
   * oluşmasını engelliyor.
   */
  networks: string[] | null;
  /** Var olan container adları — `container_name` çakışması için. */
  containerNames: string[];
  /**
   * Compose dosyasının HAM METNİ — bulgulara satır numarası yazmak için.
   *
   * `yaml` düğümlerin konumunu KARAKTER OFSETİ olarak tutuyor; satıra
   * çevirmek için metnin kendisi gerekiyor ve `Document` onu saklamıyor.
   * Boş bırakılırsa satır numarası hesaplanmıyor, bulgular yine üretiliyor.
   */
  source?: string;
};

export const EMPTY_CONTEXT: CheckContext = {
  reserved: new Map(),
  reservedAgeSeconds: null,
  panelPorts: [],
  // Bağlam vermeyen her çağıran otomatik olarak güvenli tarafa düşsün.
  networks: null,
  containerNames: [],
  source: "",
};

function raw(doc: Document, service: string, key: string): unknown {
  return doc.getIn(["services", service, key]);
}

/**
 * Karakter ofsetini satır numarasına çevirir (1'den başlar).
 *
 * Metni satırlara bölüp aramak yerine yeni satırları saymak, iki yüz satırlık
 * bir dosyada onlarca bulgu için ayrı ayrı dizi üretmemeyi sağlıyor.
 */
function satirNo(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i += 1) {
    if (source[i] === "\n") line += 1;
  }
  return line;
}

/**
 * Bir compose yolunun dosyadaki satırı; bulunamazsa `undefined`.
 *
 * En özel yoldan genele düşüyor: `services.web.ports` yoksa `services.web`
 * deneniyor. Bulgunun tam satırını gösteremiyorsak bile servisin başını
 * göstermek, hiçbir şey göstermemekten iyi.
 */
function yolSatiri(
  doc: Document,
  source: string,
  path: (string | number)[],
): number | undefined {
  if (!source) return undefined;

  for (let uzunluk = path.length; uzunluk >= 1; uzunluk -= 1) {
    const node = doc.getIn(path.slice(0, uzunluk), true) as { range?: [number, number, number] };
    if (node?.range) return satirNo(source, node.range[0]);
  }

  return undefined;
}

/**
 * Yığın içinde birden çok servis aynı host portunu isterse, `compose up`
 * çalışırken patlar. Bunu kurulumdan önce söylemek gerekiyor.
 */
function iciCakismalar(services: ServiceConfig[]): Finding[] {
  const sahip = new Map<number, string>();
  const bulgular: Finding[] = [];

  for (const service of services) {
    for (const port of service.ports) {
      if (port.published === null || port.raw !== null) continue;
      const onceki = sahip.get(port.published);
      if (onceki && onceki !== service.name) {
        bulgular.push({
          severity: "engel",
          service: service.name,
          anchor: "ports",
          title: `${port.published} portunu iki servis birden istiyor`,
          detail: `${onceki} ve ${service.name} aynı host portunu yayınlıyor; ikisi birden başlayamaz.`,
        });
      }
      sahip.set(port.published, service.name);
    }
  }

  return bulgular;
}

/** Saniyeyi insan okunur yaşa çevirir; `null` gelmesi beklenmiyor. */
function dakika(seconds: number | null): string {
  if (seconds === null) return "bilinmeyen süre";
  if (seconds < 90) return "az";
  if (seconds < 5400) return `${Math.round(seconds / 60)} dakika`;
  return `${Math.round(seconds / 3600)} saat`;
}

function portBulgulari(service: ServiceConfig, context: CheckContext): Finding[] {
  const bulgular: Finding[] = [];

  for (const port of service.ports) {
    if (port.published === null || port.raw !== null) continue;

    if (context.panelPorts.includes(port.published)) {
      bulgular.push({
        severity: "engel",
        service: service.name,
        anchor: "ports",
        title: `${port.published} panelin kendi portu`,
        detail:
          "Bu portu başka bir servise vermek paneli erişilemez hâle getirir. Başka bir port seç.",
      });
      continue;
    }

    const tutan = context.reserved.get(port.published);
    if (tutan) {
      // Taze veride ENGEL, uyarı değil: portu çalışan başka bir şey tutuyorsa
      // `compose up` bir olasılıkla değil KESİNLİKLE patlıyor. passbolt'ta tam
      // olarak bu oldu — 443'ü caddy tutuyordu, panel "uyarı" dedi, kullanıcı
      // kaydetti, yığın kalkmadı ve sebebi ancak sunucuda `docker compose up`
      // elle çalıştırılınca görüldü.
      //
      // Bayat veride UYARI: bir saatlik ölçüme dayanıp kullanıcıyı kilitlemek,
      // veriye hak ettiğinden fazla güvenmek olur.
      const taze =
        context.reservedAgeSeconds !== null &&
        context.reservedAgeSeconds <= TAZE_TARAMA_SANIYE;

      bulgular.push({
        severity: taze ? "engel" : "uyari",
        service: service.name,
        anchor: "ports",
        title: `${port.published} portu zaten kullanımda`,
        detail: taze
          ? `Bu portu şu an ${tutan} tutuyor. Docker "port is already allocated" der ve ` +
            "yığın başlamaz. Başka bir port seç ya da o portu tutanı durdur."
          : `Bu portu ${tutan} tutuyordu — ama bu bilgi ${dakika(context.reservedAgeSeconds)} ` +
            "önceki port taramasından geliyor ve o zamandan beri değişmiş olabilir. " +
            "Emin olmak için Port Haritası ekranından yeni bir tarama çalıştır.",
      });
    }
  }

  return bulgular;
}

/**
 * Anonim volume: `- /veri` gibi kaynağı olmayan tanım.
 *
 * Docker bunun için adı rastgele bir volume yaratır. `docker system prune`
 * onu siler ve veri gider — panelde prune düğmesi olduğu için bu tuzak bize
 * ait, söylemek zorundayız.
 */
function volumeBulgulari(service: ServiceConfig): Finding[] {
  const bulgular: Finding[] = [];

  for (const volume of service.volumes) {
    if (volume.startsWith("/") && !volume.includes(":")) {
      bulgular.push({
        severity: "uyari",
        service: service.name,
        title: `anonim volume: ${volume}`,
        detail:
          "Kaynağı belirtilmemiş volume'ün adı rastgele olur ve 'kullanılmayanları temizle' " +
          "işleminde silinir. Adlandırılmış bir volume ya da host dizini vermek veriyi korur.",
      });
    }
  }

  return bulgular;
}

function servisBulgulari(
  doc: Document,
  service: ServiceConfig,
  context: CheckContext,
): Finding[] {
  const bulgular: Finding[] = [];
  const build = raw(doc, service.name, "build");

  // `build:` bu akışta çalışmaz: kullanıcı yalnızca YAML yapıştırıyor,
  // Dockerfile ve build bağlamı diskte yok.
  if (build !== undefined && build !== null) {
    bulgular.push({
      severity: "engel",
      service: service.name,
      title: "build: bloğu var",
      detail:
        "Bu servis imajı yerinde derliyor; derleme için gereken Dockerfile ve dosyalar " +
        "yapıştırılan YAML ile gelmiyor. Dosyaları önce Dosya Yöneticisi ile dizine koy, " +
        "ya da hazır bir imaj kullan.",
    });
  }

  if (!service.image && (build === undefined || build === null)) {
    bulgular.push({
      severity: "engel",
      service: service.name,
      title: "image tanımlı değil",
      detail: "Servisin ne çalıştıracağı belirtilmemiş.",
    });
  }

  const containerName = raw(doc, service.name, "container_name");
  if (typeof containerName === "string" && context.containerNames.includes(containerName)) {
    bulgular.push({
      severity: "engel",
      service: service.name,
      title: `container_name çakışması: ${containerName}`,
      detail: "Bu adla çalışan bir container zaten var; Docker ikincisini yaratmaz.",
    });
  }

  if (!service.restart) {
    bulgular.push({
      severity: "oneri",
      service: service.name,
      title: "restart politikası yok",
      detail:
        "Sunucu yeniden başladığında bu container kendiliğinden gelmez. " +
        "En sık 'container kayboldu' sebebi budur.",
      fix: { kind: "restart", label: "unless-stopped ekle" },
    });
  }

  if (raw(doc, service.name, "logging") === undefined) {
    bulgular.push({
      severity: "oneri",
      service: service.name,
      title: "log döndürme yok",
      detail:
        "Varsayılan json-file sürücüsü sınırsız büyür; uzun çalışan bir servis diski " +
        "sessizce doldurur.",
      fix: { kind: "logging", label: "10 MB × 3 dosya sınırı ekle" },
    });
  }

  if (service.image.endsWith(":latest") || (service.image && !service.image.includes(":"))) {
    bulgular.push({
      severity: "oneri",
      service: service.name,
      title: "sürüm etiketi sabitlenmemiş",
      detail:
        `${service.image || "imaj"} her çekilişte farklı bir sürüm getirebilir; ` +
        "bir şey bozulduğunda geri dönülecek sürüm bilinmez.",
    });
  }

  return [
    ...bulgular,
    ...portBulgulari(service, context),
    ...volumeBulgulari(service),
  ];
}

/**
 * Üst düzey `networks:` altında `external: true` işaretli ama Docker'da
 * bulunmayan ağlar. Compose bunu `config` aşamasında zaten yakalıyor ama
 * mesajı ham; burada adıyla söyleniyor.
 */
function agBulgulari(doc: Document, context: CheckContext): Finding[] {
  // Docker'a sorulamadıysa hiçbir şey iddia etme. "Bilmiyorum" ile "yok"u
  // karıştırmak, var olan bir ağ için "bulunamadı" demek olurdu.
  if (context.networks === null) return [];

  const mevcut = context.networks;
  const top = doc.getIn(["networks"], true);
  if (!isMap(top)) return [];

  const bulgular: Finding[] = [];
  for (const item of (top as YAMLMap).items) {
    if (!isScalar(item.key)) continue;
    const name = String(item.key.value);

    // `getIn` bir eşleme için düz nesne değil YAMLMap döndürüyor; alanı doğrudan
    // yol üzerinden istemek gerekiyor.
    if (doc.getIn(["networks", name, "external"]) !== true) continue;
    if (mevcut.includes(name)) continue;

    bulgular.push({
      severity: "engel",
      service: "",
      title: `dış ağ bulunamadı: ${name}`,
      detail:
        "Bu ağ 'external' işaretli, yani compose onu yaratmaz — önceden var olmalı. " +
        "Docker'da böyle bir ağ yok.",
    });
  }

  return bulgular;
}

export function checkCompose(doc: Document, context: CheckContext = EMPTY_CONTEXT): Finding[] {
  if (serviceNames(doc).length === 0) {
    return [
      {
        severity: "engel",
        service: "",
        title: "services bloğu yok",
        detail: "Compose dosyasında tanımlı servis bulunamadı.",
      },
    ];
  }

  const services = readAllServices(doc);
  const bulgular = [
    ...services.flatMap((service) => servisBulgulari(doc, service, context)),
    ...iciCakismalar(services),
    ...agBulgulari(doc, context),
  ];

  /*
    Satır numaraları TEK YERDE yazılıyor (M3.34). Her bulgu üretim noktasında
    ayrı ayrı hesaplamak, yeni bir kontrol eklerken unutulacak bir adım
    olurdu; burada `service` ve `anchor` alanlarından türetiliyor.
  */
  const kaynak = context.source ?? "";
  const konumlu = kaynak
    ? bulgular.map((finding) => {
        if (!finding.service) return finding;
        const path = ["services", finding.service, ...(finding.anchor ? [finding.anchor] : [])];
        const line = yolSatiri(doc, kaynak, path);
        return line === undefined ? finding : { ...finding, line };
      })
    : bulgular;

  // Engeller önce: kullanıcının ilk gördüğü şey, kurulumu durduran şey olmalı.
  const sira: Record<CheckSeverity, number> = { engel: 0, uyari: 1, oneri: 2 };
  return konumlu.sort((a, b) => sira[a.severity] - sira[b.severity]);
}

/** Kurulum başlatılabilir mi — tek bir engel bile yeter. */
export function blocked(findings: Finding[]): boolean {
  return findings.some((finding) => finding.severity === "engel");
}

/**
 * "Öneri" bulgularının tek tıkla uygulanması.
 *
 * Yalnızca eksik olanı ekliyor, var olanı DEĞİŞTİRMİYOR: kullanıcının bilerek
 * yazdığı bir `restart: no` satırını "düzeltmek" panelin işi değil.
 */
export function applyFix(doc: Document, service: string, kind: "restart" | "logging"): void {
  if (kind === "restart") {
    if (doc.getIn(["services", service, "restart"]) === undefined) {
      doc.setIn(["services", service, "restart"], "unless-stopped");
    }
    return;
  }

  if (doc.getIn(["services", service, "logging"]) === undefined) {
    doc.setIn(
      ["services", service, "logging"],
      doc.createNode({ driver: "json-file", options: { "max-size": "10m", "max-file": "3" } }),
    );
  }
}

/** Belgede kullanılan bind mount kaynakları — çağıran taraf varlığını sınar. */
export function bindSources(doc: Document): { service: string; source: string }[] {
  const out: { service: string; source: string }[] = [];

  for (const service of readAllServices(doc)) {
    for (const volume of service.volumes) {
      const [source] = volume.split(":");
      // Named volume değil, host yolu olanlar: mutlak ya da ./ ile başlayan.
      if (source.startsWith("/") || source.startsWith(".")) {
        if (volume.includes(":")) out.push({ service: service.name, source });
      }
    }
  }

  return out;
}
