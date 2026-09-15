import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { bookmarkGroups, createBookmark, parseBookmark } from "@/lib/home/bookmarks";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await guardApi(request, "panel.view");
  if (!guard.ok) return guard.response;

  return Response.json({ groups: bookmarkGroups() });
}

export async function POST(request: Request) {
  // Bookmark'lar ana sayfada herkese görünür; ekleyen yetkisi kart yönetimiyle
  // aynı — ikisi de "panelin ne göstereceğine karar vermek".
  const guard = await guardApi(request, "apps.manage");
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "geçersiz istek" }, { status: 400 });
  }

  const parsed = parseBookmark(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const id = createBookmark(parsed.input);

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "bookmarks.create",
    targetId: String(id),
    detail: `${parsed.input.title} → ${parsed.input.url}`,
    result: "ok",
  });

  return Response.json({ ok: true, id, groups: bookmarkGroups() });
}
