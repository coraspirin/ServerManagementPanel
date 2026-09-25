import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { serverT } from "@/lib/i18n/runtime";
import { clientIp } from "@/lib/request";
import { checkForUpdate, startUpdate, updateStatus } from "@/lib/selfupdate";

export const dynamic = "force-dynamic";

/**
 * Panel sürümü: son kontrol + sürmekte olan/son güncellemenin durumu.
 * `?refresh=1` GitHub'a yeniden sorar (yoksa 30 dk önbellek).
 */
export async function GET(request: Request) {
  const guard = await guardApi(request, "panel.update");
  if (!guard.ok) return guard.response;

  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  const [check, status] = await Promise.all([checkForUpdate(refresh), updateStatus()]);
  return Response.json({ check, status });
}

/** Güncellemeyi başlatır. Gövde: `{ tag: "v1.11.0" }`. */
export async function POST(request: Request) {
  const guard = await guardApi(request, "panel.update");
  if (!guard.ok) return guard.response;

  let tag = "";
  try {
    tag = String(((await request.json()) as { tag?: unknown }).tag ?? "").trim();
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const entry = {
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "panel.update",
    targetType: "panel",
    targetId: tag,
    ip: clientIp(request),
  };

  try {
    await startUpdate(tag);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    audit({ ...entry, detail: message, result: "error" });
    return Response.json({ error: message }, { status: 409 });
  }

  audit({ ...entry, detail: tag });
  return Response.json({ ok: true }, { status: 202 });
}
