/**
 * İstemci — seçili sunucunun API isteklerine taşınması.
 *
 * Seçim çerezde duruyor (`panel_host`) ama çerez sekmeler arasında ortak: bir
 * sekmede sunucu değiştirilince diğer sekmedeki açık sayfanın butonları, o
 * sayfanın gösterdiği sunucuya değil yeni seçime gider. Bu yüzden her `/api/`
 * isteğine sayfanın HANGİ SUNUCU İÇİN ÇİZİLDİĞİ başlık olarak eklenir; sunucu
 * başlığı çerezden önce dinler.
 *
 * Tek tek ~110 `fetch` çağrısını değiştirmek yerine `window.fetch` bir kez
 * sarılıyor: yalnızca aynı kökenli `/api/` istekleri etkileniyor, başlık
 * çağıran tarafından zaten verilmişse dokunulmuyor. `EventSource` ve indirme
 * bağlantıları başlık gönderemediği için `withHostQuery` kullanır.
 */

const HEADER = "x-panel-host";

let currentHost: number | null = null;
let installed = false;

export function setClientHost(hostId: number | null): void {
  currentHost = hostId;
}

export function clientHost(): number | null {
  return currentHost;
}

function isPanelApi(url: string): boolean {
  if (url.startsWith("/api/")) return true;
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.origin === window.location.origin && parsed.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

export function installHostFetch(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (currentHost === null || !isPanelApi(url)) return original(input, init);

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has(HEADER)) headers.set(HEADER, String(currentHost));
    return original(input, { ...init, headers });
  };
}

/** `EventSource` / indirme bağlantısı adresine seçili sunucuyu ekler. */
export function withHostQuery(url: string): string {
  if (currentHost === null) return url;
  return `${url}${url.includes("?") ? "&" : "?"}host=${currentHost}`;
}
