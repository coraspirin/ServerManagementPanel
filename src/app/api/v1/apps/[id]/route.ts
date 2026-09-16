import { serverT } from "@/lib/i18n/runtime";
import { auditAction } from "@/lib/apiv1/action";
import { appPatchBase, mergePatch, parseId } from "@/lib/apiv1/crud";
import { guardV1 } from "@/lib/apiv1/guard";
import { readJsonBody } from "@/lib/apiv1/parse";
import { apiError, apiOk } from "@/lib/apiv1/respond";
import { serializeApp } from "@/lib/apiv1/serialize";
import { deleteLogo } from "@/lib/apps/logos";
import { deleteApp, getApp, parseAppInput, updateApp } from "@/lib/apps/store";
import { getNumber } from "@/lib/settings";
import { invalidateWidget } from "@/lib/widgets";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const guard = await guardV1(request, "panel.view");
  if (!guard.ok) return guard.response;

  const id = parseId((await params).id);
  if (id === null) return apiError("invalid_request", serverT("api.v1.invalidCardId"));

  const card = getApp(id);
  if (!card) return apiError("not_found", serverT("api.notFound.card"));

  return apiOk({ app: serializeApp(card) });
}

/**
 * Kısmi güncelleme.
 *
 * Logo temizliği İÇ UÇTAKİNİN AKSİNE burada yok ve olmamalı: `icon` v1
 * şeklinde dönmüyor, dolayısıyla istemci onu gönderemez ve `appPatchBase`
 * mevcut değeri koruyor. İkon hiç değişmediği için silinecek eski dosya da
 * yok. Buraya bir `deleteLogo` konsaydı, adını değiştiren her PATCH kartın
 * logosunu silerdi.
 */
export async function PATCH(request: Request, { params }: Context) {
  const guard = await guardV1(request, "apps.manage");
  if (!guard.ok) return guard.response;

  const id = parseId((await params).id);
  if (id === null) return apiError("invalid_request", serverT("api.v1.invalidCardId"));

  const existing = getApp(id);
  if (!existing) return apiError("not_found", serverT("api.notFound.card"));

  const body = await readJsonBody(request, getNumber("api.max_body_bytes"));
  if (!body.ok) return body.response;

  const parsed = parseAppInput(mergePatch(appPatchBase(existing), body.body));
  if (!parsed.ok) return apiError("invalid_request", parsed.error);

  // `source` GEÇİLMİYOR: `updateApp` varsayılanı "manual" ve bu doğru. Keşif
  // turuyla (M2.5) gelmiş bir kartı elle düzenlemek onu artık elle yönetilen
  // bir kart yapar; sonraki tur üzerine yazmamalı.
  updateApp(id, parsed.input);

  auditAction(guard.actor, {
    action: "apps.update",
    targetType: "app",
    targetId: String(id),
    detail:
      existing.name === parsed.input.name
        ? existing.name
        : `${existing.name} → ${parsed.input.name}`,
  });

  const card = getApp(id);
  return apiOk({ app: card ? serializeApp(card) : null });
}

export async function DELETE(request: Request, { params }: Context) {
  const guard = await guardV1(request, "apps.manage");
  if (!guard.ok) return guard.response;

  const id = parseId((await params).id);
  if (id === null) return apiError("invalid_request", serverT("api.v1.invalidCardId"));

  const existing = getApp(id);
  if (!existing) return apiError("not_found", serverT("api.notFound.card"));

  deleteApp(id);
  // İç uçla AYNI temizlik: logo dosyası ve widget önbelleği kartla birlikte
  // gider. v1'den silinen kart bunları bırakırsa `data/logos` sessizce büyür
  // ve id yeniden kullanıldığında yeni kart eski servisin sayılarını
  // gösterirdi — silme yolunun hangi uçtan geçtiği bu sonucu değiştirmemeli.
  deleteLogo(existing.icon);
  invalidateWidget(id);

  auditAction(guard.actor, {
    action: "apps.delete",
    targetType: "app",
    targetId: String(id),
    detail: existing.name,
  });

  return apiOk({ deleted: true, id });
}
