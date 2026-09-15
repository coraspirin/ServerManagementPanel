import { getDb } from "@/lib/db/client";
import { audit } from "@/lib/auth/audit";
import { createSession, setSessionCookies } from "@/lib/auth/session";
import { consumeChallenge, recoveryCodesLeft } from "@/lib/auth/twofactor";
import { clientIp } from "@/lib/request";

export const dynamic = "force-dynamic";

/**
 * Girişin ikinci adımı (M3.1). Bilet doğrulanana kadar oturum yok, dolayısıyla
 * burada guardApi kullanılmıyor; koruma biletin kendisinde: 5 dakika ömür,
 * 5 deneme hakkı, tek kullanım.
 */
export async function POST(request: Request) {
  let body: { challenge?: unknown; code?: unknown; remember?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "geçersiz istek" }, { status: 400 });
  }

  const challenge = typeof body.challenge === "string" ? body.challenge : "";
  const code = typeof body.code === "string" ? body.code : "";
  // "Beni hatırla" ilk adımda seçiliyor ama oturum burada kuruluyor. Bayrak
  // bilette taşınmıyor, istemci tekrar gönderiyor: `login_challenges` tablosuna
  // bir sütun eklemek migration demekti ve karşılığı yok — bileti elinde tutan
  // parolayı zaten doğrulamış, oturum ömrünü uzatmak yeni bir yetki değil.
  const remember = body.remember === true;
  if (!challenge || !code) {
    return Response.json({ error: "Doğrulama kodu gerekli." }, { status: 400 });
  }

  const ip = clientIp(request);
  const outcome = consumeChallenge(challenge, code);

  if (!outcome.ok) {
    audit({ action: "auth.2fa", result: "denied", ip, detail: outcome.error });
    return Response.json(
      { error: outcome.error, expired: outcome.expired ?? false },
      { status: outcome.expired ? 410 : 401 },
    );
  }

  const row = getDb()
    .prepare("SELECT username, must_change_pw FROM users WHERE id = ?")
    .get(outcome.userId) as { username: string; must_change_pw: number } | undefined;

  const session = createSession(
    outcome.userId,
    { ip, userAgent: request.headers.get("user-agent") ?? "" },
    { remember },
  );
  await setSessionCookies(session.token, session.csrfToken, session.expiresAt);

  const left = recoveryCodesLeft(outcome.userId);

  audit({
    userId: outcome.userId,
    username: row?.username ?? "",
    action: "auth.2fa",
    result: "ok",
    ip,
    detail:
      outcome.via === "recovery"
        ? `kurtarma kodu kullanıldı — ${left} kod kaldı`
        : "doğrulayıcı uygulama",
  });

  return Response.json({
    ok: true,
    mustChangePassword: Number(row?.must_change_pw ?? 0) === 1,
    // Kurtarma koduyla girildiyse kullanıcı bunu bilmeli: kod tükendi ve
    // muhtemelen telefonu elinde değil.
    usedRecoveryCode: outcome.via === "recovery",
    recoveryCodesLeft: left,
  });
}
