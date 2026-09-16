import { serverT } from "@/lib/i18n/runtime";
import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { saveLogo } from "@/lib/apps/logos";

export const dynamic = "force-dynamic";

/** Gövde belleğe alınmadan önceki kaba sınır (M2.2). */
const MAX_UPLOAD_BYTES = 1024 * 1024;

/**
 * Kart logosu yükleme.
 *
 * Karta bağlanmıyor: yükleme kart kaydedilmeden ÖNCE oluyor (kullanıcı modalda
 * önizlemeyi görmeli). Dönen `upload:<ad>` değeri kart gövdesinin `icon`
 * alanına konur. Kaydetmekten vazgeçilirse dosya sahipsiz kalır — kabul edilen
 * bir taviz: yarım kalan bir yükleme birkaç KB, karmaşık bir taslak yönetimi
 * ise kalıcı bir bakım yükü olurdu.
 */
export async function POST(request: Request) {
  const guard = await guardApi(request, "apps.manage");
  if (!guard.ok) return guard.response;

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_UPLOAD_BYTES) {
    return Response.json({ error: serverT("api.apps.fileTooLarge") }, { status: 413 });
  }

  let file: unknown;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return Response.json({ error: serverT("api.apps.invalidUpload") }, { status: 400 });
  }

  if (!(file instanceof File)) {
    return Response.json({ error: serverT("api.apps.noFile") }, { status: 400 });
  }

  const result = saveLogo(Buffer.from(await file.arrayBuffer()));
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "apps.logo.upload",
    targetType: "app_logo",
    targetId: result.name,
    result: "ok",
  });

  return Response.json({ ok: true, icon: `upload:${result.name}` });
}
