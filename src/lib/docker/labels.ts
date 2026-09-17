/**
 * Container ve image etiketleriyle panel davranışını yönlendirme (M3.27).
 *
 * OPT-OUT MODELİ: varsayılan bugünkü davranış, etiket yalnızca istisna
 * tanımlar. Etiketi olmayan hiçbir container'ın davranışı değişmiyor — bu,
 * özelliğin var olan kurulumları sessizce etkilememesinin tek yolu.
 *
 * Etiketler compose dosyasında yazılıyor ve container'la birlikte yaşıyor;
 * yani panelin veritabanında tutulan bir ayardan farklı olarak yığın başka
 * bir sunucuya taşındığında da geçerli kalıyor. Bu yüzden "bu container
 * otomatik güncellenmesin" gibi kararlar panel ayarı değil, etiket.
 *
 * I/O yok, `@/` yolu yok — `node --test` altında doğrudan çalışsın diye saf.
 */

export const LABEL = {
  update: "panel.update",
  hidden: "panel.hidden",
  notify: "panel.notify",
  url: "panel.url",
  order: "panel.order",
  /** Image etiketi — container değil (bkz. `imagePrunable`). */
  prune: "panel.prune",
} as const;

type Labels = Record<string, string> | null | undefined;

/**
 * Etiket değerini mantıksal değere çevirir.
 *
 * Compose dosyalarında bu değerler elle yazılıyor ve `True`, `yes`, `1` gibi
 * biçimler en az `true` kadar yaygın. Tanınmayan bir değerde VARSAYILANA
 * dönülüyor: bir yazım hatası yüzünden container'ın gizlenmesi ya da
 * güncellemeden düşmesi, sessiz ve teşhisi zor bir sürpriz olurdu.
 */
export function flag(labels: Labels, key: string, fallback: boolean): boolean {
  const raw = labels?.[key];
  if (raw === undefined) return fallback;

  const value = raw.trim().toLowerCase();
  if (["true", "yes", "1", "on", "evet"].includes(value)) return true;
  if (["false", "no", "0", "off", "hayir", "hayır"].includes(value)) return false; // i18n-ignore — "hayır" etiket ayrıştırma
  return fallback;
}

/** Otomatik ve toplu güncellemeye dahil mi (varsayılan: evet). */
export function updatable(labels: Labels): boolean {
  return flag(labels, LABEL.update, true);
}

/** Docker listesinde gösterilsin mi (varsayılan: evet). */
export function hidden(labels: Labels): boolean {
  return flag(labels, LABEL.hidden, false);
}

/** Olayları bildirim üretsin mi (varsayılan: evet). Denetim kaydını etkilemez. */
export function notifiable(labels: Labels): boolean {
  return flag(labels, LABEL.notify, true);
}

/**
 * "Kullanılmayanları buda" bu imajı atlasın mı.
 *
 * Talep üzerine çekilen ya da derlenen bir imaj, kullanımlar arasında
 * "kullanılmıyor" görünür ve budamada silinir; sonra yeniden indirmek gerekir.
 * Bu etiket onu korur. Yalnızca "kullanılmayanları buda" işlemini etkiliyor,
 * etiketsiz (sarkan) budamayı değil — sarkan bir imajın zaten etiketi yok.
 */
export function imagePrunable(labels: Labels): boolean {
  return flag(labels, LABEL.prune, true);
}

/** Yığın içi gösterim sırası; tanımsız ya da sayı değilse 0. */
export function order(labels: Labels): number {
  const raw = labels?.[LABEL.order];
  if (raw === undefined) return 0;
  const value = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(value) ? value : 0;
}

export type LabelLink = { label: string; url: string };

/**
 * `panel.url` ve `panel.port.<port>.url` değerlerini ayrıştırır.
 *
 * İki biçim destekleniyor: düz URL ya da `[İsim](url)`. İkincisi olmadan
 * bağlantı metni ham adres olurdu; "Home Assistant" yazan bir bağlantı
 * "http://192.168.61.114:8123"ten okunaklı.
 *
 * ⚠️ YALNIZCA http/https kabul ediliyor. Etiket değeri compose dosyasından
 * geliyor ve arayüzde bir `href`'e dönüşüyor; `javascript:` şemasına izin
 * vermek, dosyayı düzenleyebilen birine panelde betik çalıştırma imkânı
 * vermek olurdu.
 */
export function parseLink(raw: string | undefined, fallbackLabel: string): LabelLink | null {
  if (!raw) return null;

  const text = raw.trim();
  if (!text) return null;

  const markdown = text.match(/^\[([^\]]*)\]\((.+)\)$/);
  const label = markdown ? markdown[1].trim() : fallbackLabel;
  const url = (markdown ? markdown[2] : text).trim();

  if (!/^https?:\/\//i.test(url)) return null;
  return { label: label || fallbackLabel, url };
}

/** Container'ın kendi bağlantısı (`panel.url`). */
export function containerLink(labels: Labels, fallbackLabel: string): LabelLink | null {
  return parseLink(labels?.[LABEL.url], fallbackLabel);
}

/** Belirli bir host portunun bağlantısı (`panel.port.<port>.url`). */
export function portLink(labels: Labels, port: number, fallbackLabel: string): LabelLink | null {
  return parseLink(labels?.[`panel.port.${port}.url`], fallbackLabel);
}
