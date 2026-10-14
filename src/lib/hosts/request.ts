import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { runWithHost } from "./context";
import { pickHost, type HostPick } from "./resolve";
import { getHost, listHosts } from "./store";
import { HOST_COOKIE, HOST_HEADER, HOST_QUERY, type Host } from "./types";

/**
 * İstekten / sayfa yüklemesinden etkin sunucuyu çözer.
 */

function cookieFromHeader(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function resolveRequestHost(request: Request): HostPick {
  let query: string | null = null;
  try {
    query = new URL(request.url).searchParams.get(HOST_QUERY);
  } catch {
    query = null;
  }
  return pickHost(
    {
      header: request.headers.get(HOST_HEADER),
      query,
      cookie: cookieFromHeader(request.headers.get("cookie"), HOST_COOKIE),
    },
    listHosts(),
  );
}

/**
 * Server component'ler için: çerezdeki seçim, yoksa varsayılan sunucu.
 * Etkin sunucu yoksa null — çağıran `/ilk-sunucu`ya yönlendirir
 * ("İlk sunucunu ekle", kararlar.md D1).
 */
export async function resolvePageHost(): Promise<Host | null> {
  const store = await cookies();
  const pick = pickHost({ cookie: store.get(HOST_COOKIE)?.value ?? null }, listHosts());
  return pick.ok ? getHost(pick.hostId) : null;
}

/** Sayfa için sunucu; yoksa "İlk sunucunu ekle" sayfasına gönderir. */
async function requirePageHost(): Promise<Host> {
  const host = await resolvePageHost();
  if (!host) redirect("/ilk-sunucu");
  return host;
}

/**
 * Sayfalar için bağlam kurulumu:
 *
 *   await requirePermission("docker.view");
 *   enterHost(await pageHostId());
 */
export async function pageHostId(options: { agent?: boolean } = {}): Promise<number> {
  const host = await requirePageHost();
  // Ekran henüz panel-agent'a taşınmadıysa uzak sunucuda yerel veriyi
  // göstermesin (bkz. guardHostApi'deki `agent` seçeneği).
  if (host.agentType === "agent" && !options.agent) {
    redirect("/hosts/unavailable?reason=unsupported");
  }
  // Ulaşılamayan sunucunun ekranı yarı yüklenip hata sayfasına düşmesin;
  // bilgi sayfası, başka sunucu seçilince kendiliğinden geri döner.
  if (!host.isLocal && (host.status === "offline" || host.status === "incompatible")) {
    redirect(`/hosts/unavailable?reason=${host.status}`);
  }
  return host.id;
}

/**
 * Yalnızca panelin kendi sunucusunda çalışan ekranlar (host cron, LAN
 * taraması...). Uzak sunucu seçiliyken yerel sunucunun verisini göstermek
 * yanıltıcı olurdu.
 */
export async function requireLocalPage(): Promise<void> {
  const host = await requirePageHost();
  if (!host.isLocal) redirect("/hosts/unavailable?reason=unsupported");
}

/**
 * Sayfa verisini seçili sunucunun bağlamında yükler.
 *
 *   const data = await withPageHost(() => loadOverview());
 */
export async function withPageHost<T>(load: (host: Host) => Promise<T> | T): Promise<T> {
  const host = await requirePageHost();
  return runWithHost(host.id, () => load(host));
}
