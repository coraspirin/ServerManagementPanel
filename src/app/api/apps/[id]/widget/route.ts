import { serverT } from "@/lib/i18n/runtime";
import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { getApp, widgetConfig } from "@/lib/apps/store";
import { effectiveUrl, resolveHost } from "@/lib/apps/types";
import { findWidget, invalidateWidget, widgetState } from "@/lib/widgets";
import { getString } from "@/lib/settings";
import { browserHost } from "../../route";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * Widget'ın konuşacağı adres.
 *
 * `internalUrl` varsa o kazanır (M2.1): kart dışarıdaki bir alan adını
 * gösteriyor olabilir ama panel container'ının oraya çıkışı reverse proxy'ye
 * bağlıdır. Yer tutucu burada da çözülüyor — çözülmemiş bir `{host}` ile
 * yapılan istek "getaddrinfo ENOTFOUND {host}" diye anlaşılmaz bir hata verirdi.
 */
function widgetBaseUrl(
  card: NonNullable<ReturnType<typeof getApp>>,
  request: Request,
): string {
  const host = getString("apps.server_host").trim() || browserHost(request);
  return resolveHost(effectiveUrl(card), host).replace(/\/+$/, "");
}

export async function GET(request: Request, { params }: Context) {
  const guard = await guardApi(request, "panel.view");
  if (!guard.ok) return guard.response;

  const card = getApp(Number((await params).id));
  if (!card) return Response.json({ error: serverT("api.notFound.card") }, { status: 404 });
  if (!card.widgetType) return Response.json({ error: serverT("api.apps.noWidget") }, { status: 400 });

  const config = widgetConfig(card.id);
  if (config === null) {
    return Response.json({
      state: {
        status: "error",
        message:
          serverT("api.apps.widgetKeyMismatch"),
        updatedAt: null,
      },
    });
  }

  const state = await widgetState(card.id, card.widgetType, widgetBaseUrl(card, request), config);
  return Response.json({ state });
}

/** Widget aksiyonu (ör. Pi-hole'u 5 dk devre dışı bırakma). */
export async function POST(request: Request, { params }: Context) {
  // Aksiyonlar izlenen servisin DAVRANIŞINI değiştiriyor; görüntüleme yetkisi
  // yetmez. Pi-hole engellemesini kapatmak evdeki herkesi etkiler.
  const guard = await guardApi(request, "apps.manage");
  if (!guard.ok) return guard.response;

  const card = getApp(Number((await params).id));
  if (!card) return Response.json({ error: serverT("api.notFound.card") }, { status: 404 });

  const provider = findWidget(card.widgetType);
  if (!provider) return Response.json({ error: serverT("api.apps.noWidget") }, { status: 400 });

  let body: { action?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const action = String(body.action ?? "");
  if (!provider.def.actions.some((entry) => entry.key === action)) {
    return Response.json({ error: serverT("api.invalidAction") }, { status: 400 });
  }

  const config = widgetConfig(card.id);
  if (config === null) {
    return Response.json({ error: serverT("api.apps.widgetUnreadable") }, { status: 400 });
  }

  try {
    const message = await provider.act(action, {
      baseUrl: widgetBaseUrl(card, request),
      config,
    });

    // Aksiyon veriyi değiştirdi; önbellekteki eski hal kullanıcıya "hiçbir şey
    // olmadı" izlenimi verirdi.
    invalidateWidget(card.id);

    audit({
      userId: guard.session.user.id,
      username: guard.session.user.username,
      action: `widget.${card.widgetType}.${action}`,
      targetType: "app",
      targetId: String(card.id),
      detail: card.name,
      result: "ok",
    });

    return Response.json({ ok: true, message });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    audit({
      userId: guard.session.user.id,
      username: guard.session.user.username,
      action: `widget.${card.widgetType}.${action}`,
      targetType: "app",
      targetId: String(card.id),
      detail: message,
      result: "error",
    });

    return Response.json({ error: message }, { status: 502 });
  }
}
