import { guardApi } from "@/lib/auth/api";
import { getApp, moveApp } from "@/lib/apps/store";
import { launcherPayload } from "../../route";

export const dynamic = "force-dynamic";

/**
 * Kartı kendi kategorisi içinde bir sıra kaydırır (M2.4).
 *
 * Audit'e yazılmıyor: sıralama bir yetki kullanımı değil, görünüm tercihi.
 * Her ok tıklaması audit tablosuna satır düşseydi gerçek olayları gömerdi.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardApi(request, "apps.manage");
  if (!guard.ok) return guard.response;

  const id = Number((await params).id);
  if (!getApp(id)) return Response.json({ error: "kart bulunamadı" }, { status: 404 });

  let body: { direction?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "geçersiz istek" }, { status: 400 });
  }

  if (body.direction !== -1 && body.direction !== 1) {
    return Response.json({ error: "yön -1 ya da 1 olmalı" }, { status: 400 });
  }

  moveApp(id, body.direction);

  return Response.json({ ok: true, ...launcherPayload(request) });
}
