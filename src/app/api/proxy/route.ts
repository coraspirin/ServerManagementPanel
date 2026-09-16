import { serverT } from "@/lib/i18n/runtime";
import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { applyProxyConfig, currentCaddyConfig } from "@/lib/proxy/caddy";
import {
  createProxyHost,
  proxyHostViews,
  validateProxy,
  type ProxyInput,
  type TargetKind,
  type TlsMode,
} from "@/lib/proxy/store";
import { listDdnsRecords } from "@/lib/proxy/ddns";

export const dynamic = "force-dynamic";

export function parseProxyInput(
  body: Record<string, unknown>,
): { ok: true; input: ProxyInput } | { ok: false; error: string } {
  const input: ProxyInput = {
    domain: String(body.domain ?? ""),
    targetKind: (body.targetKind === "url" ? "url" : "container") as TargetKind,
    target: String(body.target ?? ""),
    port: Number(body.port ?? 80),
    tls: (["auto", "internal", "off"].includes(String(body.tls)) ? body.tls : "auto") as TlsMode,
    websocket: body.websocket !== false,
    enabled: body.enabled !== false,
    appId:
      body.appId === null || body.appId === undefined || body.appId === ""
        ? null
        : Number(body.appId),
  };

  const problem = validateProxy(input);
  return problem ? { ok: false, error: problem } : { ok: true, input };
}

export function proxyPayload() {
  return {
    hosts: proxyHostViews(),
    ddns: listDdnsRecords(),
    config: currentCaddyConfig(),
  };
}

export async function GET(request: Request) {
  const guard = await guardApi(request, "proxy.manage");
  if (!guard.ok) return guard.response;

  return Response.json(proxyPayload());
}

export async function POST(request: Request) {
  const guard = await guardApi(request, "proxy.manage");
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const parsed = parseProxyInput(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const id = createProxyHost(parsed.input);
  // Yapılandırma HEMEN uygulanıyor: "kaydettim ama yayında değil" hali,
  // kullanıcının anlamasının zor olduğu bir ara durum olurdu.
  const reload = await applyProxyConfig();

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "proxy.create",
    targetId: String(id),
    detail: `${parsed.input.domain} → ${parsed.input.target}:${parsed.input.port}`,
    result: reload.ok ? "ok" : "error",
  });

  return Response.json({ ok: true, id, reload, ...proxyPayload() });
}
