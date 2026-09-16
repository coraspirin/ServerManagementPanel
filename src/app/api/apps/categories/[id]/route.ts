import { serverT } from "@/lib/i18n/runtime";
import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { deleteCategory, listCategories, updateCategory } from "@/lib/apps/store";
import { launcherPayload } from "../../route";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

function find(id: number) {
  return listCategories().find((category) => category.id === id) ?? null;
}

export async function PATCH(request: Request, { params }: Context) {
  const guard = await guardApi(request, "apps.manage");
  if (!guard.ok) return guard.response;

  const id = Number((await params).id);
  const existing = find(id);
  if (!existing) return Response.json({ error: serverT("api.notFound.category") }, { status: 404 });

  let body: { name?: unknown; icon?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  if (!name) return Response.json({ error: serverT("api.apps.categoryNameEmpty") }, { status: 400 });

  updateCategory(id, name, String(body.icon ?? ""));

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "apps.category.update",
    targetType: "app_category",
    targetId: String(id),
    detail: existing.name === name ? name : `${existing.name} → ${name}`,
    result: "ok",
  });

  return Response.json({ ok: true, ...launcherPayload(request) });
}

/** Kategori silinir, kartları silinmez — "Diğer" grubuna düşerler. */
export async function DELETE(request: Request, { params }: Context) {
  const guard = await guardApi(request, "apps.manage");
  if (!guard.ok) return guard.response;

  const id = Number((await params).id);
  const existing = find(id);
  if (!existing) return Response.json({ error: serverT("api.notFound.category") }, { status: 404 });

  deleteCategory(id);

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "apps.category.delete",
    targetType: "app_category",
    targetId: String(id),
    detail: existing.name,
    result: "ok",
  });

  return Response.json({ ok: true, ...launcherPayload(request) });
}
