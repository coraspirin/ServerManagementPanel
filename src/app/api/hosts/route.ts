import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { createAgentHost, validateHostName } from "@/lib/hosts/agents";
import { listHosts } from "@/lib/hosts/store";
import { toHostView } from "@/lib/hosts/view";
import { serverT } from "@/lib/i18n/runtime";
import { clientIp } from "@/lib/request";

export const dynamic = "force-dynamic";

/** Sunucu listesi ve durumları (seçici, Sunucular ekranı). */
export async function GET(request: Request) {
  const guard = await guardApi(request, "hosts.view");
  if (!guard.ok) return guard.response;

  return Response.json({ hosts: listHosts().map(toHostView) });
}

/**
 * Uzak sunucu ekleme — kayıt bekleyen satır açılır ve kurulum metni (sır
 * dahil) BİR KEZ döner. Sır bir daha hiçbir uçtan okunamaz; kaybolursa
 * yenilenir (`/api/hosts/[id]/token`).
 */
export async function POST(request: Request) {
  const guard = await guardApi(request, "hosts.manage");
  if (!guard.ok) return guard.response;

  let name = "";
  try {
    name = String(((await request.json()) as { name?: unknown }).name ?? "").trim();
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const problem = validateHostName(name);
  if (problem) return Response.json({ error: problem }, { status: 400 });

  const { host, kit } = createAgentHost(name);
  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "hosts.create",
    targetType: "host",
    targetId: String(host.id),
    detail: host.name,
    ip: clientIp(request),
  });

  return Response.json({ host: toHostView(host), kit }, { status: 201 });
}
