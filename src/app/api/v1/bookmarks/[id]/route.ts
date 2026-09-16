import { serverT } from "@/lib/i18n/runtime";
import { auditAction } from "@/lib/apiv1/action";
import { bookmarkPatchBase, mergePatch, parseId } from "@/lib/apiv1/crud";
import { guardV1 } from "@/lib/apiv1/guard";
import { readJsonBody } from "@/lib/apiv1/parse";
import { apiError, apiOk } from "@/lib/apiv1/respond";
import { serializeBookmark } from "@/lib/apiv1/serialize";
import {
  deleteBookmark,
  getBookmark,
  parseBookmark,
  updateBookmark,
} from "@/lib/home/bookmarks";
import { getNumber } from "@/lib/settings";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const guard = await guardV1(request, "panel.view");
  if (!guard.ok) return guard.response;

  const id = parseId((await params).id);
  if (id === null) return apiError("invalid_request", serverT("api.v1.invalidBookmarkId"));

  const bookmark = getBookmark(id);
  if (!bookmark) return apiError("not_found", serverT("api.notFound.bookmark"));

  return apiOk({ bookmark: serializeBookmark(bookmark) });
}

export async function PATCH(request: Request, { params }: Context) {
  const guard = await guardV1(request, "apps.manage");
  if (!guard.ok) return guard.response;

  const id = parseId((await params).id);
  if (id === null) return apiError("invalid_request", serverT("api.v1.invalidBookmarkId"));

  const existing = getBookmark(id);
  if (!existing) return apiError("not_found", serverT("api.notFound.bookmark"));

  const body = await readJsonBody(request, getNumber("api.max_body_bytes"));
  if (!body.ok) return body.response;

  const parsed = parseBookmark(mergePatch(bookmarkPatchBase(existing), body.body));
  if (!parsed.ok) return apiError("invalid_request", parsed.error);

  updateBookmark(id, parsed.input);

  auditAction(guard.actor, {
    action: "bookmarks.update",
    targetType: "bookmark",
    targetId: String(id),
    detail: parsed.input.title,
  });

  const bookmark = getBookmark(id);
  return apiOk({ bookmark: bookmark ? serializeBookmark(bookmark) : null });
}

export async function DELETE(request: Request, { params }: Context) {
  const guard = await guardV1(request, "apps.manage");
  if (!guard.ok) return guard.response;

  const id = parseId((await params).id);
  if (id === null) return apiError("invalid_request", serverT("api.v1.invalidBookmarkId"));

  const existing = getBookmark(id);
  if (!existing) return apiError("not_found", serverT("api.notFound.bookmark"));

  deleteBookmark(id);

  auditAction(guard.actor, {
    action: "bookmarks.delete",
    targetType: "bookmark",
    targetId: String(id),
    detail: existing.title,
  });

  return apiOk({ deleted: true, id });
}
