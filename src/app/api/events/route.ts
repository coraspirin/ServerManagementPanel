import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { acknowledgeEvents, listEvents, unacknowledgedCount } from "@/lib/alerts/store";
import { isSeverity } from "@/lib/alerts/types";
import { channelStatuses } from "@/lib/notify";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await guardApi(request, "metrics.view");
  if (!guard.ok) return guard.response;

  const params = new URL(request.url).searchParams;
  const severity = params.get("severity") ?? "";
  const source = params.get("source") ?? "";

  return Response.json({
    events: listEvents({
      limit: Number(params.get("limit") ?? 100),
      severity: isSeverity(severity) ? severity : undefined,
      source: source || undefined,
      onlyUnacknowledged: params.get("unacknowledged") === "1",
    }),
    channels: channelStatuses(),
    unacknowledged: unacknowledgedCount(),
  });
}

/** Okundu işaretleme — tırmandırmayı da durdurur. */
export async function POST(request: Request) {
  const guard = await guardApi(request, "monitors.manage");
  if (!guard.ok) return guard.response;

  let body: { ids?: unknown };
  try {
    body = (await request.json()) as { ids?: unknown };
  } catch {
    return Response.json({ error: "geçersiz istek" }, { status: 400 });
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : [];
  if (ids.length === 0) return Response.json({ error: "id listesi gerekli" }, { status: 400 });

  const changed = acknowledgeEvents(ids, guard.session.user.username, Math.floor(Date.now() / 1000));

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "events.acknowledge",
    detail: `${changed} olay`,
    result: "ok",
  });

  return Response.json({
    ok: true,
    changed,
    events: listEvents({ limit: 100 }),
    unacknowledged: unacknowledgedCount(),
  });
}
