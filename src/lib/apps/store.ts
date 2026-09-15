import "server-only";

import { decryptSecret, encryptSecret, type EncryptedValue } from "@/lib/crypto";
import { getDb } from "@/lib/db/client";
import { isInMaintenance } from "@/lib/monitors/maintenance";
import { listMonitors } from "@/lib/monitors/store";
import { getString } from "@/lib/settings";
import { cardColor, HOST_PLACEHOLDER, iconSource, initials, resolveHost } from "./types";
import type {
  AppCard,
  AppCardView,
  AppCategory,
  AppGroup,
  AppSource,
  PublicAppCard,
  PublicAppGroup,
} from "./types";

/** M2.1 — kart ve kategori veritabanı erişimi. */

type CategoryRow = {
  id: number;
  name: string;
  icon: string;
  sort_order: number;
};

type AppRow = {
  id: number;
  category_id: number | null;
  name: string;
  description: string;
  url: string;
  internal_url: string;
  icon: string;
  color: string;
  monitor_id: number | null;
  container_name: string;
  source: string;
  widget_type: string;
  widget_config: string;
  open_new_tab: number;
  enabled: number;
  show_on_login: number;
  sort_order: number;
};

function toCategory(row: CategoryRow): AppCategory {
  return { id: row.id, name: row.name, icon: row.icon, sortOrder: row.sort_order };
}

function toCard(row: AppRow): AppCard {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    description: row.description,
    url: row.url,
    internalUrl: row.internal_url,
    icon: row.icon,
    color: row.color,
    monitorId: row.monitor_id,
    containerName: row.container_name,
    source: row.source as AppSource,
    widgetType: row.widget_type,
    widgetConfigured: row.widget_config !== "",
    openNewTab: row.open_new_tab === 1,
    enabled: row.enabled === 1,
    showOnLogin: row.show_on_login === 1,
    sortOrder: row.sort_order,
  };
}

// --- Okuma -----------------------------------------------------------------

export function listCategories(): AppCategory[] {
  return (
    getDb()
      .prepare("SELECT * FROM app_categories ORDER BY sort_order, name")
      .all() as CategoryRow[]
  ).map(toCategory);
}

export function listApps(): AppCard[] {
  return (
    getDb().prepare("SELECT * FROM apps ORDER BY sort_order, name").all() as AppRow[]
  ).map(toCard);
}

export function getApp(id: number): AppCard | null {
  const row = getDb().prepare("SELECT * FROM apps WHERE id = ?").get(id) as
    | AppRow
    | undefined;
  return row ? toCard(row) : null;
}

/**
 * Kartları bağlı monitörün durumuyla birleştirir (M2.3).
 *
 * Monitörler tek sorguda okunup haritaya alınıyor: kart başına ayrı sorgu
 * atmak, 30 kartlık bir ekranda 30 gidiş-dönüş demekti.
 *
 * Bakım penceresi kontrolü YALNIZCA monitörü olan kartlar için yapılıyor;
 * `isInMaintenance` kendi başına bir sorgu ve kartların çoğunda monitör yok.
 */
export function appViews(browserHost = ""): AppCardView[] {
  const monitors = new Map(listMonitors().map((monitor) => [monitor.id, monitor]));
  const now = new Date();

  // Ayardaki sabit adres, isteğin geldiği adresi ezer (M2.5). Boşsa kullanıcı
  // paneli hangi adresle açtıysa kartlar da oraya bakar.
  const host = getString("apps.server_host").trim() || browserHost;

  return listApps().map((card) => {
    const href = resolveHost(card.url, host);
    const monitor = card.monitorId === null ? undefined : monitors.get(card.monitorId);
    if (!monitor) {
      return {
        ...card,
        href,
        status: null,
        monitorName: null,
        inMaintenance: false,
        lastLatencyMs: null,
      };
    }

    return {
      ...card,
      href,
      // Kapalı bir monitörün son durumu eskimiş olabilir; "biliniyormuş" gibi
      // göstermek yanlış olur.
      status: monitor.enabled ? monitor.status : "bilinmiyor",
      monitorName: monitor.name,
      inMaintenance: isInMaintenance(monitor.id, now),
      lastLatencyMs: monitor.lastLatencyMs,
    };
  });
}

/**
 * Ekranın beklediği gruplu biçim.
 *
 * Kategorisiz kartlar için grup YALNIZCA kart varsa üretilir; boş bir "Diğer"
 * başlığı her ekranda asılı kalırdı. Boş kategoriler ise korunuyor: kullanıcı
 * kategoriyi kart eklemeden önce oluşturabilmeli ve oluşturduğu şey görünmeli.
 */
export function appGroups(browserHost = ""): AppGroup[] {
  const cards = appViews(browserHost);
  const groups: AppGroup[] = listCategories().map((category) => ({
    category,
    cards: cards.filter((card) => card.categoryId === category.id),
  }));

  const loose = cards.filter(
    (card) => card.categoryId === null || !groups.some((g) => g.category?.id === card.categoryId),
  );
  if (loose.length > 0) groups.push({ category: null, cards: loose });

  return groups;
}

// --- Karşılama sayfası (anonim) --------------------------------------------

type PublicRow = {
  id: number;
  name: string;
  url: string;
  icon: string;
  color: string;
  open_new_tab: number;
  category_name: string | null;
};

/**
 * Karşılama sayfasında OTURUMSUZ ziyaretçiye gösterilecek kartlar.
 *
 * `appGroups()` YENİDEN KULLANILMIYOR, bilerek. O fonksiyon tüm kart
 * alanlarını ve monitör durumunu getiriyor; buradan dönen nesne ise oturum
 * açmamış birinin tarayıcısına gidiyor. Ayrı bir sorgu yazmak, "hangi
 * sütunlar dışarı çıkıyor" sorusunun cevabını tek bir SELECT'e sabitliyor —
 * kart tablosuna yarın eklenecek bir sütun buradan kendiliğinden sızamaz.
 *
 * İki koşul birlikte aranıyor: kart etkin OLMALI ve açıkça işaretlenmiş
 * olmalı. Kapatılmış bir kartın karşılamada durması, panelde görünmeyen
 * bir şeyin dışarıda görünmesi demekti.
 */
export function publicAppGroups(browserHost = ""): PublicAppGroup[] {
  const rows = getDb()
    .prepare(
      `SELECT a.id, a.name, a.url, a.icon, a.color, a.open_new_tab,
              c.name AS category_name
         FROM apps a
         LEFT JOIN app_categories c ON c.id = a.category_id
        WHERE a.enabled = 1 AND a.show_on_login = 1
        ORDER BY c.sort_order, c.name, a.sort_order, a.name`,
    )
    .all() as PublicRow[];

  // Host çözümü appViews() ile aynı kural: ayardaki sabit adres, isteğin
  // geldiği adresi ezer (M2.5).
  const host = getString("apps.server_host").trim() || browserHost;

  const groups: PublicAppGroup[] = [];
  for (const row of rows) {
    const href = resolveHost(row.url, host);
    const source = iconSource({ icon: row.icon, url: href, name: row.name });

    const card: PublicAppCard = {
      id: row.id,
      name: row.name,
      href,
      iconSrc: publicIconSrc(row.icon, source),
      initials: initials(row.name),
      color: cardColor({ color: row.color, name: row.name }),
      openNewTab: row.open_new_tab === 1,
      // Sorgu monitör tablosuna hiç bakmıyor; burada doldurulacak veri YOK.
      // Açıkça yazılıyorlar ki alan sonradan sessizce doldurulmasın.
      status: null,
      inMaintenance: false,
    };

    // Sorgu kategoriye göre sıralı geldiği için son grubu kontrol etmek
    // yeterli; ayrı bir harita kurmaya gerek yok.
    const name = row.category_name ?? "Diğer";
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.cards.push(card);
    else groups.push({ name, cards: [card] });
  }

  return groups;
}

// --- Karşılama sayfası (oturum açık) ---------------------------------------

type WelcomeRow = PublicRow & { monitor_id: number | null };

/**
 * Karşılama sayfasında OTURUM AÇMIŞ ziyaretçiye gösterilecek kartlar.
 *
 * `publicAppGroups()` ile aynı dar tipi döndürür; iki farkı var: işaret
 * aranmaz (etkin olan her kart görünür) ve monitör durumu doldurulur.
 *
 * Ayrı bir işlev olması bilinçli. Tek işleve `withStatus` bayrağı koymak
 * "bazen oturum ara, bazen arama" diyen bir güvenlik koşulu olurdu ve ilk
 * okuyan hangi dalın ne zaman çalıştığını çıkaramazdı. İki ayrı SELECT,
 * "hangi sütunlar dışarı çıkıyor" sorusunu her iki yol için ayrı ayrı
 * sabitliyor.
 *
 * `monitor_id` SELECT'te var ama karta YAZILMIYOR: durumu sunucuda çözmek
 * için lazım, istemcinin monitör kimliğini bilmesine gerek yok.
 */
export function welcomeAppGroups(browserHost = ""): PublicAppGroup[] {
  const rows = getDb()
    .prepare(
      `SELECT a.id, a.name, a.url, a.icon, a.color, a.open_new_tab, a.monitor_id,
              c.name AS category_name
         FROM apps a
         LEFT JOIN app_categories c ON c.id = a.category_id
        WHERE a.enabled = 1
        ORDER BY c.sort_order, c.name, a.sort_order, a.name`,
    )
    .all() as WelcomeRow[];

  const monitors = new Map(listMonitors().map((monitor) => [monitor.id, monitor]));
  const now = new Date();
  const host = getString("apps.server_host").trim() || browserHost;

  const groups: PublicAppGroup[] = [];
  for (const row of rows) {
    const href = resolveHost(row.url, host);
    const source = iconSource({ icon: row.icon, url: href, name: row.name });
    const monitor = row.monitor_id === null ? undefined : monitors.get(row.monitor_id);

    const card: PublicAppCard = {
      id: row.id,
      name: row.name,
      href,
      /*
        Anonim yoldaki `publicIconSrc()` DEĞİL. O, yüklenmiş logoları dar
        `/api/login/logo` route'una yolluyor ve orası yalnızca işaretli
        kartların dosyalarını tanıyor — işaretsiz kartların logoları 404'e
        düşerdi. Oturum açmış ziyaretçi `/api/apps/logo`'yu kullanabilir.
      */
      iconSrc: source.kind === "initials" ? null : source.src,
      initials: initials(row.name),
      color: cardColor({ color: row.color, name: row.name }),
      openNewTab: row.open_new_tab === 1,
      // Kapalı monitörün son durumu eskimiş olabilir; bildiğimizi iddia etmeyelim.
      status: monitor ? (monitor.enabled ? monitor.status : "bilinmiyor") : null,
      inMaintenance: monitor ? isInMaintenance(monitor.id, now) : false,
    };

    const name = row.category_name ?? "Diğer";
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.cards.push(card);
    else groups.push({ name, cards: [card] });
  }

  return groups;
}

/**
 * Logonun anonim ziyaretçiye verilecek adresi.
 *
 * Yüklenmiş logolar `iconSource()`'un ürettiği `/api/apps/logo/...` adresine
 * GİDEMEZ: o route oturum istiyor ve istemesi de doğru. Anonim yol için
 * ayrı, dar kapsamlı bir route var (`/api/login/logo/...`) — yalnızca
 * işaretli kartların dosyalarını servis eder.
 */
function publicIconSrc(icon: string, source: ReturnType<typeof iconSource>): string | null {
  const trimmed = icon.trim();
  if (trimmed.startsWith("upload:")) {
    return `/api/login/logo/${encodeURIComponent(trimmed.slice(7))}`;
  }
  return source.kind === "initials" ? null : source.src;
}

/**
 * Bu logo dosyası karşılamada anonim görünen bir karta mı ait.
 *
 * `/api/login/logo/[file]`'in TEK sınırı bu: oturum olmadığı için dosya adı
 * dışında dayanacak bir şey yok. Kartın işareti kalkarsa logosu da anında
 * 404'e döner.
 */
export function loginLogoExists(file: string): boolean {
  return (
    getDb()
      .prepare(
        `SELECT 1 FROM apps
          WHERE icon = 'upload:' || ? AND enabled = 1 AND show_on_login = 1`,
      )
      .get(file) !== undefined
  );
}

// --- Doğrulama -------------------------------------------------------------

export type AppInput = {
  categoryId: number | null;
  name: string;
  description: string;
  url: string;
  internalUrl: string;
  icon: string;
  color: string;
  monitorId: number | null;
  containerName: string;
  openNewTab: boolean;
  enabled: boolean;
  showOnLogin: boolean;
};

/**
 * Şemasız adresi kullanılabilir hale getirir.
 *
 * Bildirim kanallarında yaşanan hatanın aynısı burada da kaçınılmaz:
 * kullanıcı "192.168.61.114:8123" yazar, `new URL` patlar ve mesaj sorunun
 * adreste olduğunu söylemez. Yerel ağ servislerinde TLS neredeyse hiç yok,
 * bu yüzden eksik şema `http://` ile tamamlanıyor.
 */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  // Şema zaten varsa (http, https, ssh, vnc, smb…) dokunulmuyor: launcher
  // yalnızca web arayüzlerine değil, istemciyle açılan adreslere de bakabilir.
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

/**
 * Adresin makine adı kısmı makul mü.
 *
 * `new URL` TEK BAŞINA yetmiyor: WHATWG ayrıştırıcısı bilerek çok bağışlayıcı
 * ve "http://ht!tp://[[[" gibi bir dizeyi bile hatasız yutuyor. Doğrulamayı
 * ona bırakınca kullanıcı yazım hatasını kaydedebiliyor ve hatayı ancak karta
 * tıkladığında görüyor.
 */
function plausibleHost(hostname: string): boolean {
  if (hostname === "") return false;
  // IPv6 köşeli parantezle gelir ([::1]); ayrıştırıcı zaten biçimini doğruladı.
  if (hostname.startsWith("[") && hostname.endsWith("]")) return true;
  return /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i.test(hostname);
}

export function validateApp(input: AppInput): string | null {
  if (!input.name.trim()) return "Ad boş olamaz.";
  if (!input.url.trim()) return "Adres boş olamaz.";

  for (const [label, value] of [
    ["Adres", input.url],
    ["Panel içi adres", input.internalUrl],
  ] as const) {
    if (!value.trim()) continue;

    // `{host}` (M2.5) geçerli bir makine adı DEĞİL; doğrulamadan önce somut
    // bir adla değiştiriliyor. Aksi halde keşfedilen bir kartı açıp kaydetmek
    // imkânsız olurdu — adres reddedilirdi. (Sunucudaki testte yakalandı.)
    const probe = normalizeUrl(value).replaceAll(HOST_PLACEHOLDER, "yer-tutucu");

    try {
      if (!plausibleHost(new URL(probe).hostname)) {
        return `${label} geçerli değil (ör. http://192.168.61.114:8123).`;
      }
    } catch {
      return `${label} geçerli değil (ör. http://192.168.61.114:8123).`;
    }
  }

  if (input.color.trim() && !/^#[0-9a-f]{6}$/i.test(input.color.trim())) {
    return "Renk #rrggbb biçiminde olmalı.";
  }

  if (input.categoryId !== null && !categoryExists(input.categoryId)) {
    return "Seçilen kategori artık yok.";
  }

  if (input.monitorId !== null && !monitorExists(input.monitorId)) {
    return "Seçilen servis izleyicisi artık yok.";
  }

  return null;
}

function categoryExists(id: number): boolean {
  return getDb().prepare("SELECT 1 FROM app_categories WHERE id = ?").get(id) !== undefined;
}

function monitorExists(id: number): boolean {
  return getDb().prepare("SELECT 1 FROM monitors WHERE id = ?").get(id) !== undefined;
}

// --- Kart CRUD -------------------------------------------------------------

/** Yeni kart listenin sonuna eklenir; mevcut sıralama bozulmasın. */
function nextSortOrder(categoryId: number | null): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM apps
       WHERE category_id IS ?`,
    )
    .get(categoryId) as { max_order: number };
  return row.max_order + 10;
}

export function createApp(input: AppInput, source: AppSource = "manual"): number {
  const result = getDb()
    .prepare(
      `INSERT INTO apps
         (category_id, name, description, url, internal_url, icon, color,
          monitor_id, container_name, source, open_new_tab, enabled,
          show_on_login, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.categoryId,
      input.name.trim(),
      input.description.trim(),
      normalizeUrl(input.url),
      normalizeUrl(input.internalUrl),
      input.icon.trim(),
      input.color.trim(),
      input.monitorId,
      input.containerName.trim(),
      source,
      input.openNewTab ? 1 : 0,
      input.enabled ? 1 : 0,
      input.showOnLogin ? 1 : 0,
      nextSortOrder(input.categoryId),
    );
  return Number(result.lastInsertRowid);
}

/**
 * Kartı günceller.
 *
 * `source` varsayılanı "manual" ÇÜNKÜ bu fonksiyonu neredeyse her zaman
 * kullanıcı düzenlemesi çağırıyor ve etiketten gelen bir kartı elle
 * düzenlemek onu sahiplenmek demektir — keşif turu bir daha dokunmaz (M2.5).
 * Keşfin kendi güncellemeleri "docker" geçirerek bu devri engeller.
 */
export function updateApp(id: number, input: AppInput, source: AppSource = "manual"): void {
  getDb()
    .prepare(
      `UPDATE apps
       SET category_id = ?, name = ?, description = ?, url = ?, internal_url = ?,
           icon = ?, color = ?, monitor_id = ?, container_name = ?,
           source = ?, open_new_tab = ?, enabled = ?, show_on_login = ?,
           updated_at = unixepoch()
       WHERE id = ?`,
    )
    .run(
      input.categoryId,
      input.name.trim(),
      input.description.trim(),
      normalizeUrl(input.url),
      normalizeUrl(input.internalUrl),
      input.icon.trim(),
      input.color.trim(),
      input.monitorId,
      input.containerName.trim(),
      source,
      input.openNewTab ? 1 : 0,
      input.enabled ? 1 : 0,
      input.showOnLogin ? 1 : 0,
      id,
    );
}

export function deleteApp(id: number): void {
  getDb().prepare("DELETE FROM apps WHERE id = ?").run(id);
}

// --- Kategori CRUD ---------------------------------------------------------

export function createCategory(name: string, icon: string): number {
  const row = getDb()
    .prepare("SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM app_categories")
    .get() as { max_order: number };

  const result = getDb()
    .prepare("INSERT INTO app_categories (name, icon, sort_order) VALUES (?, ?, ?)")
    .run(name.trim(), icon.trim(), row.max_order + 10);
  return Number(result.lastInsertRowid);
}

export function updateCategory(id: number, name: string, icon: string): void {
  getDb()
    .prepare("UPDATE app_categories SET name = ?, icon = ? WHERE id = ?")
    .run(name.trim(), icon.trim(), id);
}

/** Kartlar SİLİNMEZ; `category_id` NULL olur ve kartlar "Diğer"e düşer. */
export function deleteCategory(id: number): void {
  getDb().prepare("DELETE FROM app_categories WHERE id = ?").run(id);
}

// --- Widget yapılandırması (M2.6) -----------------------------------------

/**
 * Widget ayarları API anahtarı ve parola taşır; T3 ile şifreli saklanır.
 *
 * Tamamı tek blok olarak şifreleniyor, alan alan değil: hangi alanın gizli
 * olduğunu sağlayıcı belirliyor ve bu zamanla değişebilir. Blok şifreleme,
 * "bu alan aslında gizli olmalıydı" hatasını baştan imkânsız kılıyor.
 */
export function saveWidget(id: number, type: string, config: Record<string, string>): void {
  const payload =
    type.trim() === "" ? "" : JSON.stringify(encryptSecret(JSON.stringify(config)));

  getDb()
    .prepare("UPDATE apps SET widget_type = ?, widget_config = ?, updated_at = unixepoch() WHERE id = ?")
    .run(type.trim(), payload, id);
}

/**
 * Kayıtlı widget yapılandırması. Çözülemezse BOŞ döner, istisna fırlatmaz.
 *
 * Ayarlardaki secret'larla aynı ders: MASTER_KEY değişince okunamayan bir
 * değer yüzünden ekranın tamamı düşmemeli. Kart görünmeye devam eder, yalnızca
 * widget'ı "yapılandırma okunamıyor" der.
 */
export function widgetConfig(id: number): Record<string, string> | null {
  const row = getDb().prepare("SELECT widget_config FROM apps WHERE id = ?").get(id) as
    | { widget_config: string }
    | undefined;

  if (!row || row.widget_config === "") return {};

  try {
    return JSON.parse(decryptSecret(JSON.parse(row.widget_config) as EncryptedValue)) as Record<
      string,
      string
    >;
  } catch {
    return null;
  }
}

// --- Sıralama (M2.4) -------------------------------------------------------

export type Direction = -1 | 1;

/**
 * Sıralı bir listede bir öğeyi bir adım kaydırır ve TÜM listeyi yeniden
 * numaralar.
 *
 * Yalnızca iki komşunun `sort_order` değerini takas etmek daha az yazma olurdu
 * ama eşit değerler varken (yeni kayıtlar hep 10'ar artıyor, elle eklenen
 * kategoriler çakışabiliyor) takas hiçbir şeyi değiştirmez ve düğme "bozuk"
 * görünür. Yeniden numaralama birkaç düzine satırda bedava.
 */
function reorder(
  ids: number[],
  id: number,
  direction: Direction,
  table: "apps" | "app_categories",
): void {
  const index = ids.indexOf(id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ids.length) return;

  [ids[index], ids[target]] = [ids[target], ids[index]];

  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const update = db.prepare(`UPDATE ${table} SET sort_order = ? WHERE id = ?`);
    ids.forEach((entry, position) => update.run((position + 1) * 10, entry));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function moveCategory(id: number, direction: Direction): void {
  reorder(
    listCategories().map((category) => category.id),
    id,
    direction,
    "app_categories",
  );
}

/** Kart yalnızca KENDİ kategorisi içinde kayar; kategoriler arası taşıma düzenleme formundan yapılır. */
export function moveApp(id: number, direction: Direction): void {
  const card = getApp(id);
  if (!card) return;

  reorder(
    listApps()
      .filter((entry) => entry.categoryId === card.categoryId)
      .map((entry) => entry.id),
    id,
    direction,
    "apps",
  );
}

// --- Gövde ayrıştırma ------------------------------------------------------

/**
 * Gövdeden kart girdisi üretir; biçim hatasında mesaj döner (M2.2).
 *
 * Route dosyasından buraya taşındı (T12/Faz D) — gerekçe `parseMonitorInput`
 * ile aynı: iç uç ve `/api/v1/apps` aynı doğrulamayı paylaşmalı.
 *
 * Widget yapılandırması BİLEREK burada yok: `applyWidget` route'ta kalıyor,
 * çünkü şifreli saklanıyor ve `AppInput` içinde taşınsaydı keşif turu (M2.5)
 * farkında olmadan onu ezerdi.
 */
export function parseAppInput(
  body: Record<string, unknown>,
): { ok: true; input: AppInput } | { ok: false; error: string } {
  if (typeof body.name !== "string" || typeof body.url !== "string") {
    return { ok: false, error: "ad ve adres gerekli" };
  }

  const input: AppInput = {
    categoryId: optionalId(body.categoryId),
    name: body.name,
    description: String(body.description ?? ""),
    url: body.url,
    internalUrl: String(body.internalUrl ?? ""),
    icon: String(body.icon ?? ""),
    color: String(body.color ?? ""),
    monitorId: optionalId(body.monitorId),
    containerName: String(body.containerName ?? ""),
    openNewTab: body.openNewTab !== false,
    enabled: body.enabled !== false,
    // Diğer iki bayrağın TERSİ yönde varsayılan: eksik ya da bozuk bir gövde
    // kartı dışarı açmamalı. "Belirtilmedi" burada "hayır" demek.
    showOnLogin: body.showOnLogin === true,
  };

  const problem = validateApp(input);
  return problem ? { ok: false, error: problem } : { ok: true, input };
}

/** Boş/eksik değer "bağlantı yok" demektir, 0 değil. */
function optionalId(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}
