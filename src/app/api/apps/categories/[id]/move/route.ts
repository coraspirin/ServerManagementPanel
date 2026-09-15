import { guardApi } from "@/lib/auth/api";
import { listCategories, moveCategory } from "@/lib/apps/store";
import { launcherPayload } from "../../../route";

export const dynamic = "force-dynamic";

/** Kategoriyi bir sıra yukarı/aşağı taşır (M2.4). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardApi(request, "apps.manage");
  if (!guard.ok) return guard.response;

  const id = Number((await params).id);
  if (!listCategories().some((category) => category.id === id)) {
    return Response.json({ error: "kategori bulunamadı" }, { status: 404 });
  }

  let body: { direction?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "geçersiz istek" }, { status: 400 });
  }

  if (body.direction !== -1 && body.direction !== 1) {
    return Response.json({ error: "yön -1 ya da 1 olmalı" }, { status: 400 });
  }

  moveCategory(id, body.direction);

  return Response.json({ ok: true, ...launcherPayload(request) });
}
