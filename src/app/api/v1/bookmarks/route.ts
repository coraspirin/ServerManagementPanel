import { auditAction } from "@/lib/apiv1/action";
import { guardV1 } from "@/lib/apiv1/guard";
import { LIMITS, clampedNumber } from "@/lib/apiv1/paginate";
import { readJsonBody } from "@/lib/apiv1/parse";
import { apiError, apiOk } from "@/lib/apiv1/respond";
import { serializeBookmark } from "@/lib/apiv1/serialize";
import { createBookmark, getBookmark, listBookmarks, parseBookmark } from "@/lib/home/bookmarks";
import { getNumber } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Bookmark listesi — DÜZ, gruplanmamış.
 *
 * İç uç `bookmarkGroups()` döndürüyor çünkü ana sayfa öyle çiziyor. Gruplama
 * bir sunum kararı ve kuralı değişebilir (boş grupların gizlenmesi, sıralama);
 * sözleşmeye girmesi o kararı dondururdu. `group` alanı listede duruyor,
 * toplamayı isteyen istemci kendi yapar.
 */
export async function GET(request: Request) {
  const guard = await guardV1(request, "panel.view");
  if (!guard.ok) return guard.response;

  const search = new URL(request.url).searchParams;
  const limit = clampedNumber(
    search.get("limit"),
    LIMITS.collection.fallback,
    1,
    LIMITS.collection.max,
  );

  const all = listBookmarks();
  return apiOk({
    hostId: 1,
    bookmarks: all.slice(0, limit).map(serializeBookmark),
    hasMore: all.length > limit,
  });
}

/**
 * İzin `apps.manage` — iç uçla aynı.
 *
 * "Bookmark eklemek" ile "kart eklemek" aynı karar: ikisi de panelin ana
 * sayfasında ne görüneceğini belirliyor. Ayrı bir `bookmarks.manage` izni,
 * kullanıcıya cevaplayamayacağı bir soru sormak olurdu.
 */
export async function POST(request: Request) {
  const guard = await guardV1(request, "apps.manage");
  if (!guard.ok) return guard.response;

  const body = await readJsonBody(request, getNumber("api.max_body_bytes"));
  if (!body.ok) return body.response;

  const parsed = parseBookmark(body.body);
  if (!parsed.ok) return apiError("invalid_request", parsed.error);

  const id = createBookmark(parsed.input);

  auditAction(guard.actor, {
    action: "bookmarks.create",
    targetType: "bookmark",
    targetId: String(id),
    detail: `${parsed.input.title} → ${parsed.input.url}`,
  });

  const bookmark = getBookmark(id);
  return apiOk(
    { bookmark: bookmark ? serializeBookmark(bookmark) : null },
    { status: 201, headers: { Location: `/api/v1/bookmarks/${id}` } },
  );
}
