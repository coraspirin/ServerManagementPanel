import { guardV1 } from "@/lib/apiv1/guard";
import {
  LIMITS,
  buildPage,
  clampedNumber,
  decodeCursor,
  optionalTimestamp,
} from "@/lib/apiv1/paginate";
import { apiError, apiOk } from "@/lib/apiv1/respond";
import { serializeEvent } from "@/lib/apiv1/serialize";
import { listEventsPage } from "@/lib/alerts/store";
import { SEVERITY_ORDER, type Severity } from "@/lib/alerts/types";

export const dynamic = "force-dynamic";

/**
 * Olay geçmişi — imleçli sayfalama.
 *
 * `?since=&until=&severity=&source=&limit=&cursor=`
 */
export async function GET(request: Request) {
  const guard = await guardV1(request, "metrics.view");
  if (!guard.ok) return guard.response;

  const search = new URL(request.url).searchParams;
  const limit = clampedNumber(search.get("limit"), LIMITS.events.fallback, 1, LIMITS.events.max);

  const severityRaw = search.get("severity");
  if (severityRaw !== null && !(severityRaw in SEVERITY_ORDER)) {
    return apiError(
      "invalid_request",
      `geçersiz seviye. Geçerli değerler: ${Object.keys(SEVERITY_ORDER).join(", ")}`,
    );
  }

  const cursorRaw = search.get("cursor");
  const cursor = cursorRaw === null ? undefined : decodeCursor(cursorRaw);
  // Bozuk imleç SESSİZCE BAŞA DÖNMEZ: istemcinin hatasını gizlemek, "neden
  // hep aynı sayfayı görüyorum" sorusunu hata ayıklanamaz hâle getirirdi.
  if (cursorRaw !== null && cursor === undefined) {
    return apiError("invalid_request", "geçersiz cursor");
  }
  if (cursorRaw !== null && cursor === null) {
    return apiError("invalid_request", "geçersiz cursor");
  }

  const rows = listEventsPage({
    limit,
    severity: (severityRaw as Severity | null) ?? undefined,
    source: search.get("source") ?? undefined,
    since: optionalTimestamp(search.get("since")),
    until: optionalTimestamp(search.get("until")),
    cursor: cursor ?? undefined,
  });

  const page = buildPage(rows, limit, (row) => ({ ts: row.ts, id: row.id }));

  return apiOk({
    hostId: 1,
    items: page.items.map(serializeEvent),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  });
}
