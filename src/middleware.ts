import { NextResponse, type NextRequest } from "next/server";
import { PATH_HEADER, SESSION_COOKIE } from "@/lib/auth/types";

/**
 * Ucuz ön kontrol: oturum çerezi yoksa doğrudan /login'e yolla.
 *
 * Middleware Edge runtime'da çalışır ve veritabanına erişemez, bu yüzden
 * burada YALNIZCA çerez varlığına bakılır. Oturumun gerçekten geçerli olup
 * olmadığı sunucu tarafında (guard.ts) doğrulanır — bu katman güvenlik
 * sınırı değil, gereksiz sayfa yüklemesini önleyen bir kısayoldur.
 */
/**
 * `/api/auth/2fa` de açık olmak ZORUNDA (M3.1): girişin ikinci adımı, henüz
 * hiçbir oturum çerezi yokken çağrılıyor. Buraya eklenmeseydi middleware onu
 * 401'le keserdi ve 2FA açık olan kullanıcı hiç giriş yapamazdı. Korumasız
 * değil: yetkiyi tek kullanımlık, 5 dakika ömürlü bilet veriyor.
 */
/**
 * Burada `/kiosk`, `/api/login/logo`, `/api/v1` ve `/metrics` da vardı.
 * Uygulama kartları, kiosk ve dış API (anahtar/token sistemi) kaldırılınca
 * açık yol listesinden de çıkarıldılar.
 */
const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth/login",
  "/api/auth/2fa",
  "/api/health",
  /*
   * İlk kurulum sihirbazı — kullanıcı yokken çerez de olamaz. Korumasız değil:
   * sayfa ve uç kullanıcı varsa kapanıyor (yönlendirme / 409), yokken de
   * container logundaki tek kullanımlık kodu istiyor (lib/auth/setup.ts).
   */
  "/kurulum",
  "/api/auth/setup",
  /*
   * panel-agent uçları (çoklu sunucu). Çerezle değil HMAC imzasıyla doğrulanır
   * ve yalnızca PANEL_ROLE=agent iken cevap verir; merkez rolünde 404.
   */
  "/api/agent",
];

/**
 * Yalnızca TAM eşleşen açık yollar. Kök adres yalnızca yönlendirir (kurulum /
 * panel / giriş) ama kurulum gerekip gerekmediğini middleware bilemez
 * (veritabanı yok), o yüzden kararı sayfaya bırakmak için açık.
 *
 * ⚠️ Kök adres bu listede olmak ZORUNDA, `PUBLIC_PREFIXES`te değil. Önek
 * kontrolü `pathname.startsWith(`${p}/`)` yapıyor; oraya "/" yazılsaydı
 * `"/docker".startsWith("/")` de true dönerdi ve panelin TAMAMI oturumsuz
 * erişime açılırdı. Ayrı liste bunu yapısal olarak imkânsız kılıyor —
 * yorumla uyarmak yetmez, kalıbın kendisi yanlış kullanıma izin vermemeli.
 */
const PUBLIC_EXACT = ["/"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_EXACT.includes(pathname)) {
    return NextResponse.next();
  }

  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  if (request.cookies.has(SESSION_COOKIE)) {
    if (pathname.startsWith("/api/")) return NextResponse.next();
    const headers = new Headers(request.headers);
    headers.set(PATH_HEADER, pathname);
    return NextResponse.next({ request: { headers } });
  }

  // API isteklerini yönlendirmek yerine 401 döndür.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "oturum gerekli" }, { status: 401 }); // i18n-ignore — middleware ayarlara (DB) erişemez; istemci 401'i yönlendirmeyle karşılıyor
  }

  // Kök adres yukarıda döndüğü için buraya yalnızca gerçekten korunan bir yol
  // gelir; eskiden burada duran `pathname === "/"` ayrımı artık ölü koddu.
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
