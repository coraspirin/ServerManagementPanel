import { guardApi } from "@/lib/auth/api";
import { readLogo } from "@/lib/apps/logos";

export const dynamic = "force-dynamic";

/**
 * Yüklenmiş logoyu servis eder.
 *
 * Oturum ZORUNLU: `data/logos` panelin kalıcı verisidir ve kimliksiz bir
 * dosya sunucusuna dönüşmemeli.
 *
 * Başlıklar tesadüf değil:
 *   - `nosniff`       → tarayıcı içeriği başka bir türe yorumlamasın
 *   - `sandbox` CSP   → SVG script taşıyabiliyor; adrese doğrudan gidildiğinde
 *                       o script panel köken(origin)inde çalışırdı
 *   - `Content-Disposition: inline` + boş dosya adı → indirme değil gösterim
 */
export async function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  const guard = await guardApi(request, "panel.view");
  if (!guard.ok) return guard.response;

  const logo = readLogo((await params).file);
  if (!logo) return new Response("bulunamadı", { status: 404 });

  return new Response(new Uint8Array(logo.bytes), {
    headers: {
      "content-type": logo.mime,
      "content-length": String(logo.bytes.byteLength),
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
      "content-disposition": "inline",
      // Her yükleme yeni ve rastgele bir ad alır, adlar hiç yeniden
      // kullanılmaz: aynı ad her zaman aynı baytlar demek.
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}
