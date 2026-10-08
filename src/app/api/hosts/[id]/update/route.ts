import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import {
  agentUpdateStatus,
  agentUpdateTarget,
  manualAgentUpdateCommand,
  startAgentUpdate,
} from "@/lib/hosts/agents";
import { getHost } from "@/lib/hosts/store";
import { serverT } from "@/lib/i18n/runtime";
import { clientIp } from "@/lib/request";

export const dynamic = "force-dynamic";

/**
 * Uzak ajanın kendini güncellemesi. Hedef her zaman merkezin sürümü.
 *
 * `guardHostApi` bilerek kullanılmıyor: o çevrimdışı/uyumsuz sunucuyu
 * reddeder, oysa güncellenmesi gereken ajan çoğu zaman uyumsuz olandır.
 */

async function agentId(params: Promise<{ id: string }>): Promise<number | null> {
  const id = Number((await params).id);
  const host = Number.isInteger(id) ? getHost(id) : null;
  return host && !host.isLocal && host.agentType === "agent" ? id : null;
}

function notFound(id: string) {
  return Response.json({ error: serverT("hosts.errors.unknown", { host: id }) }, { status: 404 });
}

/** Ajanın sürümü, hedef sürüm ve ajandaki son güncellemenin durumu. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardApi(request, "panel.update");
  if (!guard.ok) return guard.response;

  const id = await agentId(params);
  if (id === null) return notFound((await params).id);
  const host = getHost(id)!;

  let status = null;
  let error: string | null = null;
  try {
    status = await agentUpdateStatus(id);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }

  return Response.json({ current: host.agentVersion, target: agentUpdateTarget(host), status, error });
}

/** Ajanı merkezin sürümüne güncellemeyi başlatır. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardApi(request, "panel.update");
  if (!guard.ok) return guard.response;

  const id = await agentId(params);
  if (id === null) return notFound((await params).id);

  const entry = {
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "agent.update",
    targetType: "host",
    targetId: String(id),
    ip: clientIp(request),
  };

  try {
    audit({ ...entry, detail: await startAgentUpdate(id) });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    audit({ ...entry, detail: message, result: "error" });
    return Response.json({ error: message, manual: manualAgentUpdateCommand() }, { status: 409 });
  }
  return Response.json({ ok: true }, { status: 202 });
}
