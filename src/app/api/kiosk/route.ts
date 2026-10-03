import { serverT } from "@/lib/i18n/runtime";
import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { activeUserByUsername } from "@/lib/auth/session";
import {
  kioskLayoutFor,
  resetKioskLayout,
  saveKioskLayout,
  validateLayout,
  type LayoutInput,
} from "@/lib/dashboard/store";
import {
  createKioskToken,
  kioskByFingerprint,
  listKioskTokens,
  revokeKioskToken,
  updateKioskToken,
} from "@/lib/home/kiosk";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await guardApi(request, "kiosk.manage");
  if (!guard.ok) return guard.response;

  // `?layout=<parmak izi>`: düzenleyici için o bağlantının düzeni.
  const fingerprint = new URL(request.url).searchParams.get("layout");
  if (fingerprint !== null) {
    const resolved = resolveKiosk(fingerprint);
    if ("error" in resolved) return resolved.error;
    return Response.json(kioskLayoutFor(resolved.kiosk.tokenHash, resolved.owner));
  }

  return Response.json({ tokens: listKioskTokens() });
}

/**
 * Bağlantı + sahibi. Düzen SAHİBİN yetkileriyle çözüldüğü için sahibi
 * pasifleştirilmiş ya da silinmiş bir bağlantının düzeni düzenlenemez —
 * kiosk zaten sade görünüme düşüyor.
 */
function resolveKiosk(fingerprint: string) {
  const kiosk = kioskByFingerprint(fingerprint);
  if (!kiosk) {
    return { error: Response.json({ error: serverT("api.notFound.link") }, { status: 404 }) };
  }
  const owner = activeUserByUsername(kiosk.createdBy);
  if (!owner) {
    return { error: Response.json({ error: serverT("home.kiosk.ownerMissing") }, { status: 409 }) };
  }
  return { kiosk, owner };
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
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
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
    detail: `${String(body.name ?? serverT("api.unnamed"))} · ${expiresAt ? serverT("api.days", { count: days }) : serverT("api.noExpiry")}`,
    result: "ok",
  });

  return Response.json({ ok: true, token, tokens: listKioskTokens() });
}

/**
 * Bağlantıyı düzenler: ad, süre, düzen. Hepsi isteğe bağlı; yalnızca
 * gönderilen alanlar değişir. `resetLayout` bağlantıya özel düzeni siler.
 */
export async function PATCH(request: Request) {
  const guard = await guardApi(request, "kiosk.manage");
  if (!guard.ok) return guard.response;

  let body: {
    fingerprint?: unknown;
    name?: unknown;
    days?: unknown;
    layout?: unknown;
    resetLayout?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const resolved = resolveKiosk(String(body.fingerprint ?? ""));
  if ("error" in resolved) return resolved.error;
  const { kiosk, owner } = resolved;

  if (body.layout !== undefined && body.resetLayout !== true) {
    const input = body.layout as LayoutInput;
    const problem = validateLayout(input);
    if (problem) return Response.json({ ok: false, error: problem }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  const patch: { name?: string; expiresAt?: number | null } = {};
  if (typeof body.name === "string") patch.name = body.name.slice(0, 100);
  if (body.days !== undefined) {
    const days = Number(body.days);
    // 0 = süresiz; aksi halde BUGÜNDEN itibaren — oluşturmadaki kuralla aynı.
    patch.expiresAt = Number.isFinite(days) && days > 0 ? now + Math.round(days) * 86400 : null;
  }
  updateKioskToken(kiosk.tokenHash, patch);

  if (body.resetLayout === true) resetKioskLayout(kiosk.tokenHash);
  else if (body.layout !== undefined) saveKioskLayout(kiosk.tokenHash, body.layout as LayoutInput, now);

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "kiosk.update",
    targetId: kiosk.fingerprint,
    result: "ok",
  });

  return Response.json({
    ok: true,
    tokens: listKioskTokens(),
    ...kioskLayoutFor(kiosk.tokenHash, owner),
  });
}

export async function DELETE(request: Request) {
  const guard = await guardApi(request, "kiosk.manage");
  if (!guard.ok) return guard.response;

  const fingerprint = new URL(request.url).searchParams.get("fingerprint") ?? "";
  if (!revokeKioskToken(fingerprint)) {
    return Response.json({ error: serverT("api.notFound.link") }, { status: 404 });
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
