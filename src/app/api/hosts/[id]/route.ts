import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { validateHostName } from "@/lib/hosts/agents";
import { getHost, removeHost, updateHostMeta } from "@/lib/hosts/store";
import { toHostView } from "@/lib/hosts/view";
import { serverT } from "@/lib/i18n/runtime";
import { clientIp } from "@/lib/request";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function hostFrom(params: Params["params"]) {
  const id = Number((await params).id);
  return Number.isInteger(id) ? getHost(id) : null;
}

/** Ad değiştirme, etkinleştirme / devre dışı bırakma. */
export async function PATCH(request: Request, { params }: Params) {
  const guard = await guardApi(request, "hosts.manage");
  if (!guard.ok) return guard.response;

  const host = await hostFrom(params);
  if (!host) return Response.json({ error: serverT("hosts.errors.unknown", { host: "?" }) }, { status: 404 });

  let body: { name?: unknown; enabled?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const patch: { name?: string; enabled?: boolean } = {};
  if (typeof body.name === "string") {
    const problem = validateHostName(body.name, host.id);
    if (problem) return Response.json({ error: problem }, { status: 400 });
    patch.name = body.name.trim();
  }
  if (typeof body.enabled === "boolean") {
    // Panelin kendi sunucusu kapatılamaz: seçici ve işler ona dayanıyor.
    if (host.isLocal && !body.enabled) {
      return Response.json({ error: serverT("hosts.validation.localAlwaysOn") }, { status: 400 });
    }
    patch.enabled = body.enabled;
  }

  updateHostMeta(host.id, patch);
  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "hosts.update",
    targetType: "host",
    targetId: String(host.id),
    detail: JSON.stringify(patch),
    ip: clientIp(request),
  });
  return Response.json({ host: toHostView(getHost(host.id)!) });
}

/** Sunucuyu ve ona ait kayıtları siler. Yerel sunucu silinemez. */
export async function DELETE(request: Request, { params }: Params) {
  const guard = await guardApi(request, "hosts.manage");
  if (!guard.ok) return guard.response;

  const host = await hostFrom(params);
  if (!host) return Response.json({ error: serverT("hosts.errors.unknown", { host: "?" }) }, { status: 404 });
  if (host.isLocal) {
    return Response.json({ error: serverT("hosts.validation.localAlwaysOn") }, { status: 400 });
  }

  removeHost(host.id);
  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "hosts.remove",
    targetType: "host",
    targetId: String(host.id),
    detail: host.name,
    ip: clientIp(request),
  });
  return Response.json({ ok: true });
}
