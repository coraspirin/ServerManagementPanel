import { enterHost, guardHostApi } from "@/lib/auth/api";
import { portScan } from "@/lib/security/ports";

export const dynamic = "force-dynamic";

/**
 * M3.17 — port haritası.
 *
 * Varsayılan okuma ÖNBELLEKTEN: gerçek tarama host ad alanında geçici bir
 * container açıyor ve birkaç saniye sürüyor; kullanıcının her sayfa açılışında
 * bunu ödemesi gerekmiyor. `?refresh=1` bilerek istenen tazelemedir.
 */
export async function GET(request: Request) {
  const guard = await guardHostApi(request, "security.view", { agent: true });
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  return Response.json(await portScan(refresh));
}
