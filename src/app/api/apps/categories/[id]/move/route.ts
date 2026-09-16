import { serverT } from "@/lib/i18n/runtime";
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
    return Response.json({ error: serverT("api.notFound.category") }, { status: 404 });
  }

  let body: { direction?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  if (body.direction !== -1 && body.direction !== 1) {
    return Response.json({ error: serverT("api.apps.direction") }, { status: 400 });
  }

  moveCategory(id, body.direction);

  return Response.json({ ok: true, ...launcherPayload(request) });
}
