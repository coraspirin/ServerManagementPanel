import { guardApi } from "@/lib/auth/api";
import { hasPermission } from "@/lib/auth/session";
import { timeline, type TimelineKind } from "@/lib/timeline";

export const dynamic = "force-dynamic";

const ALL_KINDS: TimelineKind[] = ["audit", "event", "spike"];
const DEFAULT_WINDOW_SECONDS = 24 * 3600;

export async function GET(request: Request) {
  const guard = await guardApi(request, "metrics.view");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const now = Math.floor(Date.now() / 1000);
  const until = Number(url.searchParams.get("until")) || now;
  const since = Number(url.searchParams.get("since")) || until - DEFAULT_WINDOW_SECONDS;

  const requested = (url.searchParams.get("kinds") ?? "")
    .split(",")
    .filter((kind): kind is TimelineKind => ALL_KINDS.includes(kind as TimelineKind));

  // Audit satırları "kim neyi değiştirdi" bilgisidir; `audit.view` yetkisi
  // olmayana gösterilmez. Sessizce süzülüyor, hata verilmiyor: çizelgenin
  // geri kalanı o kullanıcı için de anlamlı.
  const allowed = hasPermission(guard.session.user, "audit.view")
    ? ALL_KINDS
    : ALL_KINDS.filter((kind) => kind !== "audit");

  const kinds = (requested.length > 0 ? requested : allowed).filter((kind) =>
    allowed.includes(kind),
  );

  return Response.json({
    ...timeline({ since, until, kinds, q: url.searchParams.get("q") ?? undefined }),
    canSeeAudit: allowed.includes("audit"),
  });
}
