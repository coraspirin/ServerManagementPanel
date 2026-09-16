import { serverT } from "@/lib/i18n/runtime";
import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { deleteLogo } from "@/lib/apps/logos";
import { deleteApp, getApp, parseAppInput, updateApp } from "@/lib/apps/store";
import { invalidateWidget } from "@/lib/widgets";
import { applyWidget, launcherPayload } from "../route";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const guard = await guardApi(request, "apps.manage");
  if (!guard.ok) return guard.response;

  const id = Number((await params).id);
  const existing = getApp(id);
  if (!existing) return Response.json({ error: serverT("api.notFound.card") }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const parsed = parseAppInput(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  updateApp(id, parsed.input);

  const widgetProblem = applyWidget(id, body, existing.widgetType);
  if (widgetProblem) return Response.json({ error: widgetProblem }, { status: 400 });

  // Logo değiştiyse eskisi artık kimseye ait değil; bırakılırsa data/logos
  // her düzenlemede biraz daha büyür ve kimse fark etmez.
  if (existing.icon !== parsed.input.icon.trim()) deleteLogo(existing.icon);

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "apps.update",
    targetType: "app",
    targetId: String(id),
    detail: existing.name === parsed.input.name ? existing.name : `${existing.name} → ${parsed.input.name}`,
    result: "ok",
  });

  return Response.json({ ok: true, ...launcherPayload(request) });
}

export async function DELETE(request: Request, { params }: Context) {
  const guard = await guardApi(request, "apps.manage");
  if (!guard.ok) return guard.response;

  const id = Number((await params).id);
  const existing = getApp(id);
  if (!existing) return Response.json({ error: serverT("api.notFound.card") }, { status: 404 });

  deleteApp(id);
  deleteLogo(existing.icon);
  // Kart gitti, önbelleğindeki widget verisi de gitmeli: id yeniden
  // kullanılırsa yeni kart eski servisin sayılarını gösterirdi.
  invalidateWidget(id);

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "apps.delete",
    targetType: "app",
    targetId: String(id),
    detail: existing.name,
    result: "ok",
  });

  return Response.json({ ok: true, ...launcherPayload(request) });
}
