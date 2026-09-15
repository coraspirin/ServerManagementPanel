import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { createCategory } from "@/lib/apps/store";
import { launcherPayload } from "../route";

export const dynamic = "force-dynamic";

/**
 * Kategori oluşturma (M2.4).
 *
 * Not: bu yol `/api/apps/[id]` ile aynı seviyede duruyor. Next statik segmenti
 * dinamikten önce eşleştirdiği için çakışma yok; kart id'leri de sayısal.
 */
export async function POST(request: Request) {
  const guard = await guardApi(request, "apps.manage");
  if (!guard.ok) return guard.response;

  let body: { name?: unknown; icon?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "geçersiz istek" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  if (!name) return Response.json({ error: "Kategori adı boş olamaz." }, { status: 400 });

  const id = createCategory(name, String(body.icon ?? ""));

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "apps.category.create",
    targetType: "app_category",
    targetId: String(id),
    detail: name,
    result: "ok",
  });

  return Response.json({ ok: true, id, ...launcherPayload(request) });
}
