import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { applyProxyConfig } from "@/lib/proxy/caddy";
import { deleteProxyHost, getProxyHost, updateProxyHost } from "@/lib/proxy/store";
import { parseProxyInput, proxyPayload } from "../route";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const guard = await guardApi(request, "proxy.manage");
  if (!guard.ok) return guard.response;

  const id = Number((await params).id);
  const existing = getProxyHost(id);
  if (!existing) return Response.json({ error: "kayıt bulunamadı" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "geçersiz istek" }, { status: 400 });
  }

  const parsed = parseProxyInput(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  updateProxyHost(id, parsed.input);
  const reload = await applyProxyConfig();

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "proxy.update",
    targetId: String(id),
    detail: `${existing.domain} → ${parsed.input.domain}`,
    result: reload.ok ? "ok" : "error",
  });

  return Response.json({ ok: true, reload, ...proxyPayload() });
}

export async function DELETE(request: Request, { params }: Context) {
  const guard = await guardApi(request, "proxy.manage");
  if (!guard.ok) return guard.response;

  const id = Number((await params).id);
  const existing = getProxyHost(id);
  if (!existing) return Response.json({ error: "kayıt bulunamadı" }, { status: 404 });

  deleteProxyHost(id);
  const reload = await applyProxyConfig();

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "proxy.delete",
    targetId: String(id),
    detail: existing.domain,
    result: reload.ok ? "ok" : "error",
  });

  return Response.json({ ok: true, reload, ...proxyPayload() });
}
