import "server-only";
import { serverT } from "@/lib/i18n/runtime";

import { getDb } from "@/lib/db/client";
import { fold } from "@/lib/text";
import { currentHostId, LOCAL_HOST_ID } from "@/lib/hosts/context";
import { getHost } from "@/lib/hosts/store";
import { getDockerProvider } from "@/lib/providers";
import type { ContainerSummary } from "@/lib/providers/types";
import { getBool, getString } from "@/lib/settings";
import { createApp, createCategory, listApps, listCategories, updateApp, type AppInput } from "./store";
import { HOST_PLACEHOLDER } from "./types";

/**
 * M2.5 — Docker etiketlerinden otomatik kart keşfi.
 *
 * **Opt-in.** Yalnızca `<önek>.enable=true` etiketi taşıyan container'lar kart
 * olur. Alternatifi — "port yayınlayan her container kart olsun" — ilk turda
 * onlarca çöp kart üretir (veritabanları, broker'lar, yardımcı servisler) ve
 * kullanıcı bunları tek tek silmek zorunda kalır.
 *
 * **Sahiplik kuralı:** keşfedilen kart `source='docker'` ile açılır ve her tur
 * etiketlerden yeniden yazılır. Kullanıcı o kartı panelden düzenlerse kart
 * `source='manual'` olur ve keşif bir daha dokunmaz — "elle düzenlediysen
 * senindir". Böylece ne kullanıcının emeği eziliyor ne de iki ayrı "kim
 * kazanır" kuralı öğrenmek gerekiyor.
 *
 * **Silme:** etiket kaldırılınca ya da container yok olunca kart silinir.
 * Kullanıcı kartı panelden silerse bir sonraki tur onu geri getirir — bu bir
 * kusur değil: etiket hâlâ "bu container'ın kartı olsun" diyor. Kalıcı olarak
 * kaldırmanın yolu etiketi silmektir.
 */

export type DiscoveryResult = {
  created: string[];
  updated: string[];
  removed: string[];
  /** Etiketli ama kart üretilemeyen container'lar: ad → sebep. */
  skipped: Record<string, string>;
};

const TRUE_VALUES = new Set(["1", "true", "yes", "evet", "on"]);

function labelReader(container: ContainerSummary, prefix: string) {
  const labels = container.labels ?? {};
  return (name: string): string => (labels[`${prefix}.${name}`] ?? "").trim();
}

/**
 * Kartın adresi.
 *
 * Sıra bilinçli: açıkça yazılmış adres > açıkça yazılmış port > container'ın
 * yayınladığı ilk port. Sonuncusu tahmindir ama iyi bir tahmindir — tek port
 * yayınlayan bir web arayüzünde kullanıcıya ekstra etiket yazdırmanın anlamı
 * yok.
 */
function urlFor(
  read: (name: string) => string,
  container: ContainerSummary,
  address: string,
): string | null {
  const explicit = read("url");
  if (explicit) return explicit;

  const scheme = read("scheme") || "http";
  const path = read("path");
  const port = read("port") || firstPublishedPort(container);
  if (!port) return null;

  return `${scheme}://${address}:${port}${path && !path.startsWith("/") ? `/${path}` : path}`;
}

/**
 * Kart adresindeki makine. Yerel sunucuda `{host}` yer tutucusu (panelin
 * açıldığı adrese çözülüyor); uzak sunucuda yer tutucu yanlış makineyi
 * gösterirdi, bu yüzden ajanın adresi yazılıyor.
 */
function cardAddress(hostId: number): string {
  if (hostId === LOCAL_HOST_ID) return HOST_PLACEHOLDER;
  const host = getHost(hostId);
  if (host?.agentUrl) {
    try {
      return new URL(host.agentUrl).hostname;
    } catch {
      // Bozuk adres: aşağıdaki yedeğe düş.
    }
  }
  return host?.hostname ?? HOST_PLACEHOLDER;
}

/**
 * Yayınlanmış TCP portları, küçükten büyüğe.
 *
 * UDP atlanıyor: tarayıcıyla açılabilecek bir arayüz UDP üzerinden sunulmaz
 * (Pi-hole'un 53/udp portu kart adresi olamaz).
 */
export function publishedTcpPorts(container: ContainerSummary): number[] {
  return [
    ...new Set(
      container.ports
        .filter((port) => port.hostPort !== null && port.protocol === "tcp")
        .map((port) => port.hostPort!),
    ),
  ].sort((a, b) => a - b);
}

function firstPublishedPort(container: ContainerSummary): string {
  const published = publishedTcpPorts(container);
  return published.length > 0 ? String(published[0]) : "";
}

/** Etikette geçen kategori adı yoksa oluşturulur; ad karşılaştırması harf duyarsız. */
function categoryIdFor(name: string): number | null {
  if (!name) return null;

  const existing = listCategories().find(
    (category) => fold(category.name) === fold(name),
  );
  return existing ? existing.id : createCategory(name, "");
}

export async function runDiscovery(): Promise<DiscoveryResult> {
  const result: DiscoveryResult = { created: [], updated: [], removed: [], skipped: {} };

  const prefix = (getString("apps.label_prefix") || "panel").trim();
  // Durmuş container'lar da taranıyor: kapalı bir servisin kartı kaybolup
  // açılınca geri gelirse launcher güvenilmez olur.
  const containers = await getDockerProvider().list(true);
  const hostId = currentHostId();
  const address = cardAddress(hostId);

  const wanted = new Map<string, ContainerSummary>();
  for (const container of containers) {
    const read = labelReader(container, prefix);
    if (!TRUE_VALUES.has(read("enable").toLowerCase())) continue;
    wanted.set(container.name, container);
  }

  // Yalnızca BU sunucunun kartları: başka sunucudaki aynı adlı container'ın
  // kartı bu turda "etiketi kalkmış" sanılıp silinmesin.
  const existing = new Map(
    listApps()
      .filter((card) => card.containerName !== "" && (card.hostId ?? LOCAL_HOST_ID) === hostId)
      .map((card) => [card.containerName, card]),
  );

  for (const [name, container] of wanted) {
    const read = labelReader(container, prefix);
    const url = urlFor(read, container, address);
    if (!url) {
      result.skipped[name] = serverT("discovery.noAddress", { prefix });
      continue;
    }

    const card = existing.get(name);
    // Elle düzenlenmiş kart artık kullanıcınındır; etiketler onu ezmez.
    if (card && card.source !== "docker") continue;

    const input: AppInput = {
      categoryId: categoryIdFor(read("category")),
      name: read("name") || name,
      description: read("description"),
      url,
      internalUrl: read("internal_url"),
      icon: read("icon"),
      color: "",
      monitorId: card?.monitorId ?? null,
      containerName: name,
      openNewTab: true,
      enabled: true,
      // `monitorId` ile aynı gerekçe: bu alanın karşılığı bir etikette yok,
      // kullanıcının kararı. Her taramada false yazmak, kartı giriş ekranına
      // koyan kişinin işaretini on dakika sonra sessizce silerdi.
      showOnLogin: card?.showOnLogin ?? false,
    };

    if (!card) {
      createApp(input, "docker", hostId);
      result.created.push(name);
      continue;
    }

    // Değişiklik yoksa yazma: her turda `updated_at` güncellemek, "bu kart ne
    // zaman değişti" sorusunu cevapsız bırakırdı.
    const same =
      card.name === input.name.trim() &&
      card.description === input.description.trim() &&
      card.url === input.url &&
      card.internalUrl === input.internalUrl.trim() &&
      card.icon === input.icon.trim() &&
      card.categoryId === input.categoryId;

    if (!same) {
      // "docker" açıkça geçiliyor: varsayılan "manual" olsaydı keşfin kendi
      // güncellemesi kartı sahiplenmiş sayılır ve bir daha güncellenmezdi.
      updateApp(card.id, input, "docker");
      result.updated.push(name);
    }
  }

  // Etiketi kalkan ya da tamamen yok olan container'ların kartları gider.
  // Yalnızca `source='docker'` olanlar: kullanıcının sahiplendiği bir kart,
  // container silinse bile onun kararıdır.
  const db = getDb();
  for (const [name, card] of existing) {
    if (card.source !== "docker" || wanted.has(name)) continue;
    db.prepare("DELETE FROM apps WHERE id = ?").run(card.id);
    result.removed.push(name);
  }

  return result;
}

/** Sunucu başına sonuçları tek özet için birleştirir. */
export function mergeDiscovery(results: DiscoveryResult[]): DiscoveryResult {
  return results.reduce<DiscoveryResult>(
    (all, result) => ({
      created: [...all.created, ...result.created],
      updated: [...all.updated, ...result.updated],
      removed: [...all.removed, ...result.removed],
      skipped: { ...all.skipped, ...result.skipped },
    }),
    { created: [], updated: [], removed: [], skipped: {} },
  );
}

/** İnsan okunur özet — job günlüğü ve ekran bildirimi aynı metni kullanır. */
export function describeDiscovery(result: DiscoveryResult): string {
  const parts: string[] = [];
  if (result.created.length) parts.push(serverT("discovery.created", { count: result.created.length }));
  if (result.updated.length) parts.push(serverT("discovery.updated", { count: result.updated.length }));
  if (result.removed.length) parts.push(serverT("discovery.removed", { count: result.removed.length }));

  const skipped = Object.keys(result.skipped).length;
  if (skipped) parts.push(serverT("discovery.skipped", { count: skipped }));

  return parts.length > 0 ? parts.join(" · ") : serverT("discovery.noChanges");
}

/** Keşif kapalıysa job hiçbir şey yapmamalı ama sebebini söylemeli. */
export function discoveryEnabled(): boolean {
  return getBool("apps.discovery_enabled");
}
