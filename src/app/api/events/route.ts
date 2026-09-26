import { serverT } from "@/lib/i18n/runtime";
import { enterHost, guardHostApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { acknowledgeEvents, listEvents, unacknowledgedCount } from "@/lib/alerts/store";
import { isSeverity } from "@/lib/alerts/types";
import { channelStatuses } from "@/lib/notify";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await guardHostApi(request, "metrics.view", { agent: true });
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  const params = new URL(request.url).searchParams;
  const severity = params.get("severity") ?? "";
  const source = params.get("source") ?? "";

  return Response.json({
    events: listEvents({
      limit: Number(params.get("limit") ?? 100),
      severity: isSeverity(severity) ? severity : undefined,
      source: source || undefined,
      onlyUnacknowledged: params.get("unacknowledged") === "1",
      hostId: guard.hostId,
    }),
    channels: channelStatuses(),
    unacknowledged: unacknowledgedCount(guard.hostId),
  });
}

/** Okundu işaretleme — tırmandırmayı da durdurur. */
export async function POST(request: Request) {
  const guard = await guardHostApi(request, "monitors.manage", { agent: true });
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  let body: { ids?: unknown };
  try {
    body = (await request.json()) as { ids?: unknown };
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : [];
  if (ids.length === 0) return Response.json({ error: serverT("api.idsRequired") }, { status: 400 });

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
    events: listEvents({ limit: 100, hostId: guard.hostId }),
    unacknowledged: unacknowledgedCount(guard.hostId),
  });
}
