import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import {
  appGroups,
  createApp,
  listCategories,
  parseAppInput,
  saveWidget,
  widgetConfig,
} from "@/lib/apps/store";
import { invalidateWidget, mergeWidgetConfig, validateWidgetConfig } from "@/lib/widgets";

export const dynamic = "force-dynamic";

/**
 * Gövdedeki widget bölümünü kartın üstüne uygular (M2.6).
 *
 * Kart yazımından AYRI tutuluyor: yapılandırma şifreli saklanıyor ve `AppInput`
 * içinde taşınsaydı keşif turu (M2.5) da farkında olmadan onu ezerdi.
 */
export function applyWidget(
  id: number,
  body: Record<string, unknown>,
  previousType: string,
): string | null {
  if (!("widgetType" in body)) return null;

  // Yapılandırma değiştiyse önbellekteki veri başka bir kurulumun verisi
  // olabilir (adres ya da hesap değişmiş olabilir); tazesi çekilsin.
  invalidateWidget(id);

  const type = String(body.widgetType ?? "").trim();
  if (type === "") {
    saveWidget(id, "", {});
    return null;
  }

  const incoming = (body.widgetConfig ?? {}) as Record<string, string>;
  // Widget türü değiştiyse eskisinin değerleri taşınmaz: farklı servisin
  // parolasını yeni widget'a devretmek hem anlamsız hem tehlikeli.
  const previous = type === previousType ? (widgetConfig(id) ?? {}) : {};
  const merged = mergeWidgetConfig(type, previous, incoming);

  const problem = validateWidgetConfig(type, merged);
  if (problem) return problem;

  saveWidget(id, type, merged);
  return null;
}

/**
 * Ekranın tek seferde ihtiyaç duyduğu her şey.
 *
 * `Host` başlığı kart adreslerindeki `{host}` yer tutucusunu çözmek için
 * gerekiyor (M2.5): panel, kullanıcının kendisine hangi adresle ulaştığını
 * ancak bu başlıktan bilebilir.
 */
export function launcherPayload(request: Request) {
  return { groups: appGroups(browserHost(request)), categories: listCategories() };
}

/** Port düşürülüyor: kart kendi portunu zaten taşıyor. */
export function browserHost(request: Request): string {
  const header = request.headers.get("host") ?? "";
  // IPv6 köşeli parantezli gelir ([::1]:8443); portu ayırırken parçalanmasın.
  const match = /^(\[[^\]]+\]|[^:]+)(?::\d+)?$/.exec(header.trim());
  return match ? match[1] : "";
}

export async function GET(request: Request) {
  // Kartları GÖRMEK panel.view yeterli: ev halkı kısayolları kullanabilmeli.
  const guard = await guardApi(request, "panel.view");
  if (!guard.ok) return guard.response;

  return Response.json(launcherPayload(request));
}

export async function POST(request: Request) {
  const guard = await guardApi(request, "apps.manage");
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "geçersiz istek" }, { status: 400 });
  }

  const parsed = parseAppInput(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const id = createApp(parsed.input);

  const widgetProblem = applyWidget(id, body, "");
  if (widgetProblem) return Response.json({ error: widgetProblem }, { status: 400 });

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "apps.create",
    targetType: "app",
    targetId: String(id),
    detail: `${parsed.input.name} → ${parsed.input.url}`,
    result: "ok",
  });

  return Response.json({ ok: true, id, ...launcherPayload(request) });
}
