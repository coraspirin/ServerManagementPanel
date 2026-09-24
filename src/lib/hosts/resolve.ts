import { LOCAL_HOST_ID } from "./context.ts";

/**
 * İstekten sunucu seçimi — saf karar mantığı.
 *
 * Öncelik: başlık > sorgu parametresi > çerez > yerel sunucu.
 *  - Başlığı `apiFetch` ekler; iki sekme farklı sunuculara bakıyorsa her
 *    istek kendi sekmesinin seçimini taşır (çerez sekmeler arasında ortak).
 *  - Sorgu parametresi `EventSource` gibi başlık gönderemeyen istemciler için.
 *  - Çerez sayfa (server component) yüklemeleri için.
 */

export type HostCandidate = { id: number; name: string; enabled: boolean };

export type HostPickInput = {
  header?: string | null;
  query?: string | null;
  cookie?: string | null;
};

export type HostPick =
  | { ok: true; hostId: number; explicit: boolean }
  | { ok: false; reason: "unknown" | "disabled"; value: string };

function match(value: string, hosts: readonly HostCandidate[]): HostCandidate | undefined {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const id = Number(trimmed);
    return hosts.find((h) => h.id === id);
  }
  return hosts.find((h) => h.name === trimmed);
}

export function pickHost(input: HostPickInput, hosts: readonly HostCandidate[]): HostPick {
  // Başlık ve sorgu açık bir istek — geçersizse hata. Çerez eski/silinmiş bir
  // sunucuyu gösteriyor olabilir; o durumda sessizce yerele düşülür.
  for (const value of [input.header, input.query]) {
    if (!value) continue;
    const host = match(value, hosts);
    if (!host) return { ok: false, reason: "unknown", value };
    if (!host.enabled) return { ok: false, reason: "disabled", value };
    return { ok: true, hostId: host.id, explicit: true };
  }

  if (input.cookie) {
    const host = match(input.cookie, hosts);
    if (host?.enabled) return { ok: true, hostId: host.id, explicit: false };
  }

  return { ok: true, hostId: LOCAL_HOST_ID, explicit: false };
}
