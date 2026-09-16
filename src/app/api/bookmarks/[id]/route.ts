import { serverT } from "@/lib/i18n/runtime";
import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import {
  bookmarkGroups,
  deleteBookmark,
  getBookmark,
  parseBookmark,
  updateBookmark,
} from "@/lib/home/bookmarks";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const guard = await guardApi(request, "apps.manage");
  if (!guard.ok) return guard.response;

  const id = Number((await params).id);
  const existing = getBookmark(id);
  if (!existing) return Response.json({ error: serverT("api.notFound.bookmark") }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const parsed = parseBookmark(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  updateBookmark(id, parsed.input);

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "bookmarks.update",
    targetId: String(id),
    detail: parsed.input.title,
    result: "ok",
  });

  return Response.json({ ok: true, groups: bookmarkGroups() });
}

export async function DELETE(request: Request, { params }: Context) {
  const guard = await guardApi(request, "apps.manage");
  if (!guard.ok) return guard.response;

  const id = Number((await params).id);
  const existing = getBookmark(id);
  if (!existing) return Response.json({ error: serverT("api.notFound.bookmark") }, { status: 404 });

  deleteBookmark(id);

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "bookmarks.delete",
    targetId: String(id),
    detail: existing.title,
    result: "ok",
  });

  return Response.json({ ok: true, groups: bookmarkGroups() });
}
