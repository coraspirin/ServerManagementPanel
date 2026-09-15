import { guardApi } from "@/lib/auth/api";
import { diagnoseProxyHost, lanDnsServer } from "@/lib/proxy/diagnose";
import { getProxyHost } from "@/lib/proxy/store";

/**
 * M2.8 düzeltmesi — tek bir yayınlama kaydını uçtan uca sınar.
 *
 * POST (GET değil): DNS sorgusu, TLS el sıkışması ve Caddy içinde komut
 * çalıştırıyor. Yan etkisiz değil ve tarayıcı tarafından ön yüklenmemeli.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guard = await guardApi(request, "proxy.manage");
  if (!guard.ok) return guard.response;

  let body: { id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "geçersiz istek" }, { status: 400 });
  }

  const host = getProxyHost(Number(body.id ?? 0));
  if (!host) return Response.json({ error: "kayıt bulunamadı" }, { status: 404 });

  // Panele hangi adresten gelindiği, yerel DNS'i tahmin etmenin en iyi yolu:
  // kullanıcının tarayıcısı o adrese ulaşabiliyorsa aynı ağdadır.
  const lanServer = lanDnsServer(request.headers.get("host"));

  return Response.json({ ok: true, result: await diagnoseProxyHost(host, lanServer) });
}
