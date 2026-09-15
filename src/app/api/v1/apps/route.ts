import { auditAction } from "@/lib/apiv1/action";
import { guardV1 } from "@/lib/apiv1/guard";
import { LIMITS, clampedNumber } from "@/lib/apiv1/paginate";
import { readJsonBody } from "@/lib/apiv1/parse";
import { apiError, apiOk } from "@/lib/apiv1/respond";
import { serializeApp } from "@/lib/apiv1/serialize";
import { createApp, getApp, listApps, parseAppInput } from "@/lib/apps/store";
import { getNumber } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Uygulama katalogu.
 *
 * `appViews()` DEĞİL `listApps()`: o fonksiyon monitör durumunu birleştiriyor
 * ve `{host}` yer tutucusunu isteğin geldiği adrese göre çözüyor. İkisi de bu
 * uç için yanlış — monitör durumu zaten /api/v1/monitors'ta ve dış bir
 * istemcinin isteğinden çözülen adres, o istemci için anlamsız bir değer
 * üretebilirdi. Ham `url` dönüyor, yorumu çağırana ait.
 */
export async function GET(request: Request) {
  const guard = await guardV1(request, "panel.view");
  if (!guard.ok) return guard.response;

  const search = new URL(request.url).searchParams;
  const limit = clampedNumber(
    search.get("limit"),
    LIMITS.collection.fallback,
    1,
    LIMITS.collection.max,
  );

  const all = listApps();
  return apiOk({
    hostId: 1,
    apps: all.slice(0, limit).map(serializeApp),
    hasMore: all.length > limit,
  });
}

/**
 * Kart oluşturur.
 *
 * WIDGET YAPILANDIRMASI v1'DE YOK — bilerek. İç uç `applyWidget` ile
 * `widgetType` + `widgetConfig` alıyor; o yapılandırma servis parolaları
 * taşıyor ve şifreli saklanıyor (M2.6). Bir bearer token'ın parola yazabildiği
 * bir uç, token'ın kapsamını "panel ayarlarını görüntüle"den "panelin
 * sakladığı sırları değiştir"e taşırdı. Widget kurulumu panelden yapılır;
 * v1'den gelen kartlar widget'sız doğar ve mevcut kartların yapılandırması
 * v1 PATCH'inden etkilenmez.
 */
export async function POST(request: Request) {
  const guard = await guardV1(request, "apps.manage");
  if (!guard.ok) return guard.response;

  const body = await readJsonBody(request, getNumber("api.max_body_bytes"));
  if (!body.ok) return body.response;

  const parsed = parseAppInput(body.body);
  if (!parsed.ok) return apiError("invalid_request", parsed.error);

  const id = createApp(parsed.input);

  auditAction(guard.actor, {
    action: "apps.create",
    targetType: "app",
    targetId: String(id),
    detail: `${parsed.input.name} → ${parsed.input.url}`,
  });

  const card = getApp(id);
  return apiOk(
    { app: card ? serializeApp(card) : null },
    { status: 201, headers: { Location: `/api/v1/apps/${id}` } },
  );
}
