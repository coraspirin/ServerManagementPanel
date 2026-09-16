import { serverT } from "@/lib/i18n/runtime";
import { guardApi } from "@/lib/auth/api";
import { rescheduleJobs } from "@/lib/jobs/runner";
import { resetSetting, resolveAll, seededKeys, setSetting } from "@/lib/settings";
import { settingDefs, settingGroups } from "@/settings.schema";

export const dynamic = "force-dynamic";

/** Şema + etkin değerler. Ayarlar ekranı bu tek çağrıdan üretilir. */
export async function GET(request: Request) {
  const guard = await guardApi(request, "settings.view");
  if (!guard.ok) return guard.response;

  const seeded = seededKeys();

  return Response.json({
    groups: settingGroups,
    defs: settingDefs.map((def) => ({ ...def, seededFromEnv: seeded.has(def.key) })),
    values: resolveAll(),
  });
}

/** Tek ayar güncelleme veya varsayılana döndürme. */
export async function PATCH(request: Request) {
  const guard = await guardApi(request, "settings.edit");
  if (!guard.ok) return guard.response;

  let body: { key?: unknown; value?: unknown; reset?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  if (typeof body.key !== "string") {
    return Response.json({ error: serverT("api.keyRequired") }, { status: 400 });
  }

  const actor = {
    updatedBy: guard.session.user.username,
    userId: guard.session.user.id,
  };

  const result =
    body.reset === true
      ? resetSetting(body.key, actor)
      : setSetting(body.key, body.value, actor);

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  // T9 `onChange`: zamanlama ayarı değiştiyse ilgili iş anında yeniden
  // zamanlanır — yeniden başlatma gerekmez.
  rescheduleJobs(body.key);

  return Response.json({ ok: true, values: resolveAll() });
}
