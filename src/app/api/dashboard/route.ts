import { serverT } from "@/lib/i18n/runtime";
import { guardApi } from "@/lib/auth/api";
import { layoutFor, resetLayout, saveLayout, validateLayout } from "@/lib/dashboard/store";

/** M3.13 — kişisel gösterge paneli düzeni. */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Yetki `panel.view`: herkesin kendi düzeni var, ayrı bir izin gerekmiyor.
  // Düzen yalnızca çağıranın KENDİ satırlarını okuyor/yazıyor; başkasının
  // düzenine dokunmanın bir yolu bilerek bırakılmadı.
  const guard = await guardApi(request, "panel.view");
  if (!guard.ok) return guard.response;

  return Response.json({
    layout: layoutFor(guard.session.user.id, guard.session.user.permissions),
  });
}

export async function POST(request: Request) {
  const guard = await guardApi(request, "panel.view");
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const user = guard.session.user;

  if (body.action === "reset") {
    resetLayout(user.id);
    return Response.json({ ok: true, layout: layoutFor(user.id, user.permissions) });
  }

  if (body.action === "save") {
    const input = (body.layout as { key: string; visible: boolean }[]) ?? [];
    const problem = validateLayout(input);
    if (problem) return Response.json({ ok: false, error: problem }, { status: 400 });

    saveLayout(user.id, input, Math.floor(Date.now() / 1000));
    return Response.json({ ok: true, layout: layoutFor(user.id, user.permissions) });
  }

  return Response.json({ ok: false, error: serverT("api.unknownAction") }, { status: 400 });
}
