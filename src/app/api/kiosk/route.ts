import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { createKioskToken, listKioskTokens, revokeKioskToken } from "@/lib/home/kiosk";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await guardApi(request, "kiosk.manage");
  if (!guard.ok) return guard.response;

  return Response.json({ tokens: listKioskTokens() });
}

/**
 * Yeni kiosk bağlantısı üretir.
 *
 * Düz token yanıtta YALNIZCA BİR KEZ dönüyor: veritabanında özeti saklandığı
 * için sonradan gösterilemez. Arayüz bunu kullanıcıya açıkça söylemeli.
 */
export async function POST(request: Request) {
  const guard = await guardApi(request, "kiosk.manage");
  if (!guard.ok) return guard.response;

  let body: { name?: unknown; days?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "geçersiz istek" }, { status: 400 });
  }

  const days = Number(body.days ?? 0);
  // 0 = süresiz: duvardaki ekranın altı ay sonra kendiliğinden kararması
  // istenmez. Süre vermek isteyen verir.
  const expiresAt =
    Number.isFinite(days) && days > 0 ? Math.floor(Date.now() / 1000) + days * 86400 : null;

  const token = createKioskToken(
    String(body.name ?? ""),
    guard.session.user.username,
    expiresAt,
  );

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "kiosk.create",
    detail: `${String(body.name ?? "(adsız)")} · ${expiresAt ? `${days} gün` : "süresiz"}`,
    result: "ok",
  });

  return Response.json({ ok: true, token, tokens: listKioskTokens() });
}

export async function DELETE(request: Request) {
  const guard = await guardApi(request, "kiosk.manage");
  if (!guard.ok) return guard.response;

  const fingerprint = new URL(request.url).searchParams.get("fingerprint") ?? "";
  if (!revokeKioskToken(fingerprint)) {
    return Response.json({ error: "bağlantı bulunamadı" }, { status: 404 });
  }

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "kiosk.revoke",
    targetId: fingerprint,
    result: "ok",
  });

  return Response.json({ ok: true, tokens: listKioskTokens() });
}
