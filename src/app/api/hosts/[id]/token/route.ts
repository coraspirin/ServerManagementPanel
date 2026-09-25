import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { regenerateAgentKit } from "@/lib/hosts/agents";
import { serverT } from "@/lib/i18n/runtime";
import { clientIp } from "@/lib/request";

export const dynamic = "force-dynamic";

/**
 * Ajan sırrını yeniler ve kurulum metnini yeniden verir. Eski sır ve
 * sertifika sabitlemesi geçersizleşir: ajan yeni sırla başlatılıp yeniden
 * kaydedilene kadar sunucuya bağlanılmaz.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardApi(request, "hosts.manage");
  if (!guard.ok) return guard.response;

  const id = Number((await params).id);
  const kit = Number.isInteger(id) ? regenerateAgentKit(id) : null;
  if (!kit) return Response.json({ error: serverT("hosts.errors.unknown", { host: String(id) }) }, { status: 404 });

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "hosts.token_reset",
    targetType: "host",
    targetId: String(id),
    ip: clientIp(request),
  });
  return Response.json({ kit });
}
