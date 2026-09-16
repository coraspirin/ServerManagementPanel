import { serverT } from "@/lib/i18n/runtime";
import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import {
  deleteDdnsRecord,
  getDdnsRecord,
  saveDdnsRecord,
  syncDdns,
  type DdnsProvider,
} from "@/lib/proxy/ddns";
import { proxyPayload } from "../route";

export const dynamic = "force-dynamic";

const PROVIDERS: DdnsProvider[] = ["cloudflare", "duckdns"];

export async function POST(request: Request) {
  const guard = await guardApi(request, "proxy.manage");
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  // "Şimdi eşitle" aynı uçtan: ayrı bir yol açmak, aynı yetki ve aynı
  // yanıt biçimi için ikinci bir dosya demekti.
  if (body.action === "sync") {
    const result = await syncDdns();
    audit({
      userId: guard.session.user.id,
      username: guard.session.user.username,
      action: "ddns.sync",
      detail: serverT("api.proxy.ddnsSummary", { updated: result.updated.length, failed: result.failed.length }),
      result: result.failed.length > 0 ? "error" : "ok",
    });
    return Response.json({ ok: true, result, ...proxyPayload() });
  }

  const provider = String(body.provider ?? "");
  if (!PROVIDERS.includes(provider as DdnsProvider)) {
    return Response.json({ error: serverT("api.proxy.invalidProvider") }, { status: 400 });
  }

  const hostname = String(body.hostname ?? "").trim();
  if (!hostname) return Response.json({ error: serverT("api.proxy.hostnameEmpty") }, { status: 400 });

  const zone = String(body.zone ?? "").trim();
  if (provider === "cloudflare" && !zone) {
    return Response.json(
      { error: serverT("api.proxy.zoneIdRequired") },
      { status: 400 },
    );
  }

  const id = body.id === undefined || body.id === null ? null : Number(body.id);
  if (id !== null && !getDdnsRecord(id)) {
    return Response.json({ error: serverT("api.notFound.record") }, { status: 404 });
  }

  const saved = saveDdnsRecord(
    id,
    { provider: provider as DdnsProvider, hostname, zone, enabled: body.enabled !== false },
    String(body.secret ?? ""),
  );

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: id === null ? "ddns.create" : "ddns.update",
    targetId: String(saved),
    detail: `${provider} · ${hostname}`,
    result: "ok",
  });

  return Response.json({ ok: true, id: saved, ...proxyPayload() });
}

export async function DELETE(request: Request) {
  const guard = await guardApi(request, "proxy.manage");
  if (!guard.ok) return guard.response;

  const id = Number(new URL(request.url).searchParams.get("id") ?? "0");
  const existing = getDdnsRecord(id);
  if (!existing) return Response.json({ error: serverT("api.notFound.record") }, { status: 404 });

  deleteDdnsRecord(id);

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "ddns.delete",
    targetId: String(id),
    detail: existing.hostname,
    result: "ok",
  });

  return Response.json({ ok: true, ...proxyPayload() });
}
