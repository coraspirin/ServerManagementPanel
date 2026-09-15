import { attemptLogin } from "@/lib/auth/login";
import { createSession, setSessionCookies } from "@/lib/auth/session";
import { createChallenge, totpEnabled } from "@/lib/auth/twofactor";
import { clientIp } from "@/lib/request";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { username?: unknown; password?: unknown; remember?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "geçersiz istek" }, { status: 400 });
  }

  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const remember = body.remember === true;

  if (!username || !password) {
    return Response.json({ error: "Kullanıcı adı ve parola gerekli." }, { status: 400 });
  }

  const ip = clientIp(request);
  const result = attemptLogin(username, password, ip);

  if (!result.ok) {
    if (result.reason === "locked") {
      const minutes = Math.ceil((result.retryAfterSeconds ?? 0) / 60);
      return Response.json(
        { error: `Çok fazla hatalı deneme. ${minutes} dakika sonra tekrar deneyin.` },
        { status: 429 },
      );
    }
    if (result.reason === "inactive") {
      return Response.json({ error: "Bu hesap devre dışı." }, { status: 403 });
    }
    // Kullanıcı yok / parola yanlış ayrımı sızdırılmaz.
    return Response.json({ error: "Kullanıcı adı veya parola hatalı." }, { status: 401 });
  }

  const userAgent = request.headers.get("user-agent") ?? "";

  // 2FA açıksa oturum HENÜZ kurulmuyor. Parolayı bilmek tek başına yetmiyor;
  // bunun yerine kısa ömürlü bir bilet veriliyor (M3.1).
  if (totpEnabled(result.userId)) {
    return Response.json({
      ok: true,
      needsSecondFactor: true,
      challenge: createChallenge(result.userId, { ip, userAgent }),
    });
  }

  const session = createSession(
    result.userId,
    { ip, userAgent },
    { remember },
  );
  await setSessionCookies(session.token, session.csrfToken, session.expiresAt);

  return Response.json({
    ok: true,
    mustChangePassword: result.mustChangePassword,
  });
}
