import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { enrollAgentHost } from "@/lib/hosts/agents";
import { toHostView } from "@/lib/hosts/view";
import { serverT } from "@/lib/i18n/runtime";
import { clientIp } from "@/lib/request";

export const dynamic = "force-dynamic";

/**
 * Ajana bağlan ve sertifikasını sabitle. Yeniden çağrılabilir: adres
 * değiştiyse ya da ajan yeniden kurulduysa (yeni sertifika) aynı uç kullanılır.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardApi(request, "hosts.manage");
  if (!guard.ok) return guard.response;

  const id = Number((await params).id);
  let agentUrl = "";
  try {
    agentUrl = String(((await request.json()) as { agentUrl?: unknown }).agentUrl ?? "");
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const result = await enrollAgentHost(id, agentUrl);
  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "hosts.enroll",
    targetType: "host",
    targetId: String(id),
    detail: result.ok ? agentUrl : `${agentUrl} — ${result.error}`,
    ip: clientIp(request),
    result: result.ok ? "ok" : "error",
  });

  if (!result.ok) return Response.json({ error: result.error }, { status: 502 });
  return Response.json({ host: toHostView(result.host) });
}
