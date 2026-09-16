import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/types";

/**
 * Ucuz ön kontrol: oturum çerezi yoksa doğrudan /login'e yolla.
 *
 * Middleware Edge runtime'da çalışır ve veritabanına erişemez, bu yüzden
 * burada YALNIZCA çerez varlığına bakılır. Oturumun gerçekten geçerli olup
 * olmadığı sunucu tarafında (guard.ts) doğrulanır — bu katman güvenlik
 * sınırı değil, gereksiz sayfa yüklemesini önleyen bir kısayoldur.
 */
/**
 * `/kiosk` bilerek açık: duvara asılı ekran oturum taşımaz, yetkiyi adresteki
 * token verir ve token sayfanın kendisinde doğrulanır (M2.7). Buraya
 * eklenmeseydi middleware onu /login'e yollardı ve kiosk hiç çalışmazdı.
 */
/**
 * `/api/auth/2fa` de açık olmak ZORUNDA (M3.1): girişin ikinci adımı, henüz
 * hiçbir oturum çerezi yokken çağrılıyor. Buraya eklenmeseydi middleware onu
 * 401'le keserdi ve 2FA açık olan kullanıcı hiç giriş yapamazdı. Korumasız
 * değil: yetkiyi tek kullanımlık, 5 dakika ömürlü bilet veriyor.
 */
/**
 * Burada `/metrics` ve `/api/hooks` da vardı (M3.11). Otomasyon bölümüyle
 * birlikte kaldırıldılar: ikisi de API anahtarıyla kimlik doğruluyordu ve
 * anahtar üretecek arayüz kalmayınca kullanılamaz hâle geldiler. Açık yol
 * listesini gereksiz genişletmemek için buradan da çıkarıldılar.
 */
const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth/login",
  "/api/auth/2fa",
  "/api/health",
  "/kiosk",
  /*
   * Karşılama sayfasındaki kartların logoları. Sayfa açıksa görselleri de açık
   * olmalı, yoksa her kart baş harflerine düşerdi.
   *
   * `/api/apps/logo` DEĞİL: burası ayrı ve dar bir route ve oturum yerine
   * "bu dosya karşılama sayfasında görünen bir karta mı ait" sorusuna bakıyor.
   * Gerçek sınır orada; bu satır her zamanki gibi yalnızca kısayol.
   */
  "/api/login/logo",
  /*
   * Dış API (T12). Yukarıdaki yorum bunların NEDEN çıkarıldığını anlatıyor;
   * geri gelmelerinin sebebi o yorumda eksik olan şeyin tamamlanması:
   * anahtar üretecek arayüz artık var (/hesap → API anahtarları).
   *
   * Burada olmaları korumasız oldukları anlamına GELMEZ — çerez yok diye
   * middleware'in 401'i yanlış olurdu, gerçek sınır guardV1'de: bearer
   * çözümleme, izin kontrolü, iki ayrı hız sınırı ve `api.enabled` şalteri.
   * Şalter kapalıyken guardV1 hepsine 404 döner.
   */
  "/api/v1",
  "/metrics",
];

/**
 * Yalnızca TAM eşleşen açık yollar.
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
    return NextResponse.next();
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
