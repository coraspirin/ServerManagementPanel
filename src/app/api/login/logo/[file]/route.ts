import { serverT } from "@/lib/i18n/runtime";
import { loginLogoExists } from "@/lib/apps/store";
import { readLogo } from "@/lib/apps/logos";

export const dynamic = "force-dynamic";

/**
 * Karşılamadaki kartların logolarını oturum olmadan servis eder.
 *
 * `/api/apps/logo/[file]` DEĞİŞTİRİLMEDİ: oradaki `panel.view` zorunluluğu
 * yerinde duruyor. Ayrı bir route olmasının sebebi tam olarak bu — "bazen
 * oturum ara, bazen arama" diyen tek bir dosya, ilk okuyanın hangi dalın ne
 * zaman çalıştığını çıkaramayacağı bir güvenlik kararı olurdu.
 *
 * Oturum yok, o yüzden sınır dosya adında değil VERİDE: `loginLogoExists`
 * yalnızca karşılamada anonim görünen bir karta ait dosyalara evet der. Kartın
 * işareti kalkarsa logo aynı anda 404'e döner. Var olmayan dosya ile
 * "işaretsiz karta ait" dosya aynı cevabı alır; hangisi olduğu söylenmez.
 *
 * Başlıklar `/api/apps/logo/[file]` ile aynı gerekçelerle burada da var:
 * SVG script taşıyabiliyor ve adrese doğrudan gidildiğinde o script panel
 * kökeninde çalışırdı.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;

  if (!loginLogoExists(file)) return new Response(serverT("api.notFound.generic"), { status: 404 });

  // `readLogo` dosya adı desenini ayrıca doğruluyor; DB'den geçmiş olmak
  // diskte gezinmeye izin vermek anlamına gelmemeli.
  const logo = readLogo(file);
  if (!logo) return new Response(serverT("api.notFound.generic"), { status: 404 });

  return new Response(new Uint8Array(logo.bytes), {
    headers: {
      "content-type": logo.mime,
      "content-length": String(logo.bytes.byteLength),
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
      "content-disposition": "inline",
      // `private` değil `public`: içerik zaten oturumsuz erişilebilir ve
      // dosya adı rastgele üretilip hiç yeniden kullanılmıyor — aynı ad her
      // zaman aynı baytlar demek.
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
