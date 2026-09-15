import "server-only";

import { loadFixture } from "@/lib/fixtures";
import { deleteCache, readCache, writeCache } from "@/lib/db/cache";
import { isMockMode } from "@/lib/env";
import { getNumber } from "@/lib/settings";
import { piholeWidget } from "./pihole";
import type { WidgetData, WidgetDef, WidgetProvider, WidgetState } from "./types";

/**
 * M2.6 — widget kayıt defteri.
 *
 * Yeni bir servis eklemek = bir dosya yazıp bu diziye eklemek. Kart formu,
 * API ucu, önbellek ve hata gösterimi ortak; entegrasyonun kendisi yalnızca
 * "bu servisten veriyi nasıl alırım" sorusunu cevaplar.
 */
const providers: WidgetProvider[] = [piholeWidget];

export function findWidget(key: string): WidgetProvider | undefined {
  return providers.find((provider) => provider.def.key === key);
}

/** Arayüze gönderilecek tanımlar — sağlayıcı kodu istemciye taşınmaz. */
export function widgetDefs(): WidgetDef[] {
  return providers.map((provider) => provider.def);
}

/**
 * MOCK_MODE'da fixture'dan besleme (T10).
 *
 * Widget'ların çoğu panelde OLMAYAN servislere bağlanıyor; geliştirirken
 * ekranın nasıl göründüğünü görmenin başka yolu yok.
 */
async function mockData(key: string): Promise<WidgetData> {
  const fixture = await loadFixture<Record<string, WidgetData>>("widgets");
  const data = fixture[key];
  if (!data) throw new Error(`'${key}' için sahte veri yok (fixtures/widgets.json).`);
  return data;
}

function cacheKey(appId: number): string {
  return `widget:${appId}`;
}

/**
 * Widget verisi — önbellekten ya da servisten.
 *
 * Önbellek ZORUNLU: Uygulamalar ekranı saniyeler aralıkla yenileniyor ve her
 * yenilemede her karta bir dış istek atmak, izlenen servisi panelin kendisi
 * yorardı. Ayrıca Pi-hole gibi oturum sayan servislerde bu doğrudan zarar.
 */
export async function widgetState(
  appId: number,
  key: string,
  baseUrl: string,
  config: Record<string, string>,
): Promise<WidgetState> {
  const ttl = getNumber("apps.widget_ttl");
  const cached = readCache<WidgetData>(cacheKey(appId));
  const now = Math.floor(Date.now() / 1000);

  if (cached && now - cached.updatedAt < ttl) {
    return { status: "ok", data: cached.value, updatedAt: cached.updatedAt, stale: false };
  }

  const provider = findWidget(key);
  if (!provider) return { status: "error", message: `Bilinmeyen widget: ${key}`, updatedAt: null };

  try {
    const data = isMockMode()
      ? await mockData(key)
      : await provider.load({ baseUrl, config });
    writeCache(cacheKey(appId), data);
    return { status: "ok", data, updatedAt: now, stale: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Servis geçici olarak ulaşılamıyorsa eldeki veri hâlâ bir şey anlatıyor.
    // Yaşı `updatedAt` ile bildiriliyor ve kart "eski veri" diye işaretleniyor —
    // tazeliği gizlemek yanlış veriden tehlikelidir.
    if (cached) {
      return { status: "ok", data: cached.value, updatedAt: cached.updatedAt, stale: true };
    }
    return { status: "error", message, updatedAt: null };
  }
}

/**
 * Formdan gelen yapılandırmayı kayıtlının üstüne bindirir.
 *
 * Gizli alanlar arayüze GERİ DÖNMÜYOR (parola taşıyorlar), dolayısıyla form
 * onları hep boş gönderir. Boşu "sil" saysaydık kullanıcı kartın adını
 * değiştirdiğinde Pi-hole parolası da silinirdi. Boş = "dokunma"; silmek
 * isteyen widget'ı kaldırır.
 */
export function mergeWidgetConfig(
  key: string,
  previous: Record<string, string>,
  incoming: Record<string, string>,
): Record<string, string> {
  const provider = findWidget(key);
  if (!provider) return incoming;

  const merged: Record<string, string> = {};
  for (const field of provider.def.fields) {
    const value = (incoming[field.key] ?? "").trim();
    merged[field.key] =
      field.type === "secret" && value === "" ? (previous[field.key] ?? "") : value;
  }
  return merged;
}

/** Zorunlu alanı boş kalan widget kaydedilmemeli. */
export function validateWidgetConfig(
  key: string,
  config: Record<string, string>,
): string | null {
  const provider = findWidget(key);
  if (!provider) return `Bilinmeyen widget: ${key}`;

  const missing = provider.def.fields
    .filter((field) => field.required && !(config[field.key] ?? "").trim())
    .map((field) => field.label);

  return missing.length > 0 ? `Eksik widget ayarı: ${missing.join(", ")}` : null;
}

/** Aksiyon sonrası önbellek geçersizleşir: kullanıcı etkiyi hemen görmeli. */
export function invalidateWidget(appId: number): void {
  deleteCache(cacheKey(appId));
}
