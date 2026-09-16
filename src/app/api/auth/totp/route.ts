import { serverT } from "@/lib/i18n/runtime";
import QRCode from "qrcode";

import { getDb } from "@/lib/db/client";
import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { verifyPassword } from "@/lib/crypto";
import {
  beginEnrollment,
  confirmEnrollment,
  disableTotp,
  recoveryCodesLeft,
  regenerateRecoveryCodes,
  totpEnabled,
} from "@/lib/auth/twofactor";
import { clientIp } from "@/lib/request";

export const dynamic = "force-dynamic";

/**
 * Kendi hesabının 2FA'sı (M3.1). Herkes kendi 2FA'sını yönetir — `panel.view`
 * yeter, `users.manage` istenmez: aksi halde yalnızca yöneticiler kendilerini
 * koruyabilirdi.
 *
 * KAPATMA ve KURTARMA KODU YENİLEME parola ister. Açık bir oturumu ele geçiren
 * saldırgan, parolayı bilmeden ikinci adımı devre dışı bırakamamalı.
 */

function passwordOf(userId: number): string {
  const row = getDb().prepare("SELECT password_hash FROM users WHERE id = ?").get(userId) as
    | { password_hash: string }
    | undefined;
  return row?.password_hash ?? "";
}

export async function GET(request: Request) {
  const guard = await guardApi(request, "panel.view");
  if (!guard.ok) return guard.response;

  return Response.json({
    enabled: totpEnabled(guard.session.user.id),
    recoveryCodesLeft: recoveryCodesLeft(guard.session.user.id),
  });
}

/** Kayıt başlangıcı: sır üretilir, QR döner. 2FA henüz AÇILMAZ. */
export async function POST(request: Request) {
  const guard = await guardApi(request, "panel.view");
  if (!guard.ok) return guard.response;

  const user = guard.session.user;
  if (totpEnabled(user.id)) {
    return Response.json(
      { error: serverT("api.auth.totpAlreadyOn") },
      { status: 409 },
    );
  }

  const enrollment = beginEnrollment(user.id, user.username);
  const qrSvg = await QRCode.toString(enrollment.uri, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
  });

  return Response.json({ secret: enrollment.secret, uri: enrollment.uri, qrSvg });
}

/** Kayıt onayı: telefondaki kod doğrulanır, kurtarma kodları BİR KEZ döner. */
export async function PUT(request: Request) {
  const guard = await guardApi(request, "panel.view");
  if (!guard.ok) return guard.response;

  let body: { code?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const user = guard.session.user;
  const outcome = confirmEnrollment(user.id, typeof body.code === "string" ? body.code : "");

  if (!outcome.ok) {
    audit({
      userId: user.id,
      username: user.username,
      action: "auth.2fa.enable",
      result: "denied",
      ip: clientIp(request),
      detail: outcome.error,
    });
    return Response.json({ error: outcome.error }, { status: 400 });
  }

  audit({
    userId: user.id,
    username: user.username,
    action: "auth.2fa.enable",
    result: "ok",
    ip: clientIp(request),
    detail: serverT("api.auth.recoveryGenerated", { count: outcome.recoveryCodes.length }),
  });

  return Response.json({ ok: true, recoveryCodes: outcome.recoveryCodes });
}

export async function DELETE(request: Request) {
  const guard = await guardApi(request, "panel.view");
  if (!guard.ok) return guard.response;

  let body: { password?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const user = guard.session.user;
  const password = typeof body.password === "string" ? body.password : "";

  if (!verifyPassword(password, passwordOf(user.id))) {
    audit({
      userId: user.id,
      username: user.username,
      action: "auth.2fa.disable",
      result: "denied",
      ip: clientIp(request),
      detail: serverT("api.auth.passwordNotVerified"),
    });
    return Response.json({ error: serverT("api.auth.passwordWrong") }, { status: 401 });
  }

  disableTotp(user.id);
  audit({
    userId: user.id,
    username: user.username,
    action: "auth.2fa.disable",
    result: "ok",
    ip: clientIp(request),
  });

  return Response.json({ ok: true });
}

/** Kurtarma kodlarını yeniler; eskiler geçersiz olur. */
export async function PATCH(request: Request) {
  const guard = await guardApi(request, "panel.view");
  if (!guard.ok) return guard.response;

  let body: { password?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const user = guard.session.user;
  if (!totpEnabled(user.id)) {
    return Response.json({ error: serverT("api.auth.totpNotOn") }, { status: 409 });
  }

  if (!verifyPassword(typeof body.password === "string" ? body.password : "", passwordOf(user.id))) {
    return Response.json({ error: serverT("api.auth.passwordWrong") }, { status: 401 });
  }

  const codes = regenerateRecoveryCodes(user.id);
  audit({
    userId: user.id,
    username: user.username,
    action: "auth.2fa.recovery",
    result: "ok",
    ip: clientIp(request),
    detail: `${codes.length} kod yenilendi`,
  });

  return Response.json({ ok: true, recoveryCodes: codes });
}
