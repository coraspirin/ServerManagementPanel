/**
 * M2.1 — App Launcher paylaşılan tipleri.
 *
 * `server-only` YOK: hem sunucu tarafı store hem de Uygulamalar ekranı kullanır.
 */

/** Kartı kim oluşturdu — keşif turu elle eklenmiş kartlara dokunmaz (M2.5). */
export type AppSource = "manual" | "docker";

export type AppCategory = {
  id: number;
  name: string;
  icon: string;
  sortOrder: number;
};

export type AppCard = {
  id: number;
  categoryId: number | null;
  name: string;
  description: string;
  /** Tıklanınca açılan adres. */
  url: string;
  /** Panelin kendi isteklerinde kullandığı adres; boşsa `url`. */
  internalUrl: string;
  icon: string;
  color: string;
  monitorId: number | null;
  containerName: string;
  source: AppSource;
  widgetType: string;
  /**
   * Widget yapılandırması kayıtlı mı (M2.6).
   *
   * Değerin KENDİSİ hiç istemciye gitmez — parola taşıyor. Form yalnızca
   * "kayıtlı bir değer var, boş bırakırsan korunur" diyebilmek için bunu bilir.
   */
  widgetConfigured: boolean;
  openNewTab: boolean;
  enabled: boolean;
  /**
   * Kart karşılama sayfasında oturumsuz da listelensin mi.
   *
   * `enabled`den ayrı bir soru: "kart çalışsın mı" ile "kartı oturum açmamış
   * herkes görsün mü" aynı karar değil. Varsayılan kapalı.
   */
  showOnLogin: boolean;
  sortOrder: number;
};

/**
 * Kart + bağlı monitörün o anki durumu (M2.3).
 *
 * Kart kendi kontrolünü YAPMAZ; M1.2'nin zaten çalışan monitör turundan
 * okunur. Böylece aralık, zaman aşımı, flap koruması ve bakım pencereleri
 * tek yerde kalır — launcher ikinci bir "servis ayakta mı" mantığı doğurmaz.
 */
/**
 * Adreslerde kullanılabilen yer tutucu (M2.5).
 *
 * Keşfedilen kartların adresi `http://{host}:8081` gibi kaydedilir. Sebebi:
 * panel container'ı, kullanıcının paneli HANGİ adresle açtığını bilmez ve
 * bilemez — aynı sunucuya evden `192.168.61.114`, dışarıdan bir alan adıyla,
 * tailnet üzerinden `100.x` ile erişilebilir. Adresi keşif anında sabitlemek,
 * kartların yalnızca bir yoldan çalışması demekti.
 *
 * Yer tutucu, isteği karşılayan sunucu tarafında `Host` başlığından çözülür;
 * `apps.server_host` ayarı doluysa o kazanır.
 */
export const HOST_PLACEHOLDER = "{host}";

export function resolveHost(url: string, host: string): string {
  if (!host || !url.includes(HOST_PLACEHOLDER)) return url;
  return url.replaceAll(HOST_PLACEHOLDER, host);
}

export type AppCardView = AppCard & {
  /**
   * Tıklanacak adres: `url`'in {host} çözülmüş hali.
   *
   * `url` HAM kalıyor çünkü düzenleme formu kullanıcının yazdığı şeyi
   * göstermeli — çözülmüş adresi kaydetseydi yer tutucu ilk düzenlemede
   * sessizce yok olurdu.
   */
  href: string;
  /** null = karta monitör bağlanmamış; nokta gösterilmez. */
  status: AppStatus | null;
  monitorName: string | null;
  inMaintenance: boolean;
  lastLatencyMs: number | null;
};

/**
 * Karşılama sayfasına giden biçim.
 *
 * `AppCardView` DEĞİL: o tip `internalUrl`, `containerName`, `monitorId`,
 * `widgetType` gibi iç altyapı verisi taşıyor ve bir server component'ten
 * istemciye geçirilen her alan HTML payload'ına yazılıyor. Oturum açmamış
 * ziyaretçinin göreceği alanlar burada tek tek sayılıyor: listeye yeni bir
 * şey eklemek bilinçli bir hareket olmalı, kartın büyümesinin yan etkisi
 * değil.
 *
 * Alanlar sunucuda ÇÖZÜLMÜŞ geliyor (adres, logo adresi, renk) — istemcinin
 * `icon` ham biçimini ya da `{host}` yer tutucusunu görmesine gerek yok.
 */
/** Monitörü olmayan kartta `null`; kapalı monitörde "bilinmiyor". */
export type AppStatus = "up" | "down" | "bilinmiyor";

export type PublicAppCard = {
  id: number;
  name: string;
  /** `{host}` çözülmüş, tıklanınca açılan adres. */
  href: string;
  /** null → logo yok, baş harflere düşülür. */
  iconSrc: string | null;
  /** Logo kırılırsa gösterilecek yedek. */
  initials: string;
  color: string;
  openNewTab: boolean;
  /**
   * Servis durumu — YALNIZCA oturum açmış ziyaretçi için doldurulur.
   *
   * Anonim yolda her zaman `null`, üstelik tesadüfen değil: `publicAppGroups()`
   * monitör tablosuna hiç bakmıyor, dolayısıyla bu alanı dolduracak veriye
   * sahip değil. Hangi servisin ne zaman çöktüğü dışarıdan okunabilecek bir
   * bilgi değil.
   */
  status: AppStatus | null;
  inMaintenance: boolean;
};

/** Kategorisiz kartlar "Diğer" adıyla gelir; grup nesnesi taşınmaz. */
export type PublicAppGroup = { name: string; cards: PublicAppCard[] };

/** Ekranın gösterdiği biçim: kategoriler ve içlerindeki kartlar. */
export type AppGroup = {
  /** null = kategorisiz kartlar ("Diğer"). */
  category: AppCategory | null;
  cards: AppCardView[];
};

export type StatusStyle = { dot: string; label: string };

/**
 * Durum noktasının rengi ve etiketi.
 *
 * Parametre `AppCardView` değil yapısal bir şekil: aynı gösterim hem panel
 * içindeki zengin kartta hem de karşılama sayfasının dar `PublicAppCard`'ında
 * lazım ve ikisi de bu iki alanı taşıyor.
 */
export function statusStyle(card: {
  status: AppStatus | null;
  inMaintenance: boolean;
}): StatusStyle | null {
  if (card.status === null) return null;
  if (card.inMaintenance) return { dot: "bg-brand", label: "bakımda" };
  if (card.status === "up") return { dot: "bg-ok", label: "çalışıyor" };
  if (card.status === "down") return { dot: "bg-danger", label: "çevrimdışı" };
  return { dot: "bg-line", label: "henüz kontrol edilmedi" };
}

/**
 * Logonun nereden geleceği.
 *
 * Karar sunucuda değil burada veriliyor çünkü aynı mantık hem kart listesinde
 * hem de düzenleme modalının önizlemesinde lazım.
 */
export type IconSource =
  | { kind: "url"; src: string }
  | { kind: "favicon"; src: string }
  | { kind: "initials"; text: string };

export function iconSource(card: Pick<AppCard, "icon" | "url" | "name">): IconSource {
  const icon = card.icon.trim();

  if (icon.startsWith("upload:")) {
    return { kind: "url", src: `/api/apps/logo/${encodeURIComponent(icon.slice(7))}` };
  }
  if (/^https?:\/\//i.test(icon)) return { kind: "url", src: icon };

  // Favicon: servisin kendi sunduğu simge. Tarayıcı doğrudan çeker — panel
  // aracılık etmez, yoksa her kart için sunucudan bir dış istek daha çıkardı.
  try {
    const origin = new URL(card.url).origin;
    return { kind: "favicon", src: `${origin}/favicon.ico` };
  } catch {
    return { kind: "initials", text: initials(card.name) };
  }
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toLocaleUpperCase("tr");
  return (words[0][0] + words[1][0]).toLocaleUpperCase("tr");
}

/**
 * Rengi verilmemiş kartlar için addan türetilen sabit renk.
 *
 * Rastgele değil deterministik: aynı kart her açılışta aynı renkte olmalı,
 * yoksa göz kartları renkten tanıyamaz. Palet elle seçildi — HSL'den hesaplanan
 * renkler koyu temada okunaksız tonlara düşüyordu.
 */
const PALETTE = [
  "#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c",
  "#ca8a04", "#16a34a", "#0d9488", "#0891b2", "#4f46e5",
];

export function cardColor(card: Pick<AppCard, "color" | "name">): string {
  if (card.color.trim()) return card.color.trim();

  let hash = 0;
  for (const char of card.name) hash = (hash * 31 + char.codePointAt(0)!) % 100_000;
  return PALETTE[hash % PALETTE.length];
}

/** Durum kontrolü ve widget'lar bu adresi kullanır (M2.3, M2.6). */
export function effectiveUrl(card: Pick<AppCard, "url" | "internalUrl">): string {
  return card.internalUrl.trim() || card.url;
}
