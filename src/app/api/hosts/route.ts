import { guardApi } from "@/lib/auth/api";
import { listHosts } from "@/lib/hosts/store";
import { toHostView } from "@/lib/hosts/view";

export const dynamic = "force-dynamic";

/** Sunucu listesi ve durumları (seçici, Sunucular ekranı). */
export async function GET(request: Request) {
  const guard = await guardApi(request, "hosts.view");
  if (!guard.ok) return guard.response;

  return Response.json({ hosts: listHosts().map(toHostView) });
}
