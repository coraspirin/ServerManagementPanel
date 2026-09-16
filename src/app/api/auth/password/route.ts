import { serverT } from "@/lib/i18n/runtime";
import { audit } from "@/lib/auth/audit";
import { attemptLogin, changePassword } from "@/lib/auth/login";
import { currentSession, destroyAllSessionsForUser } from "@/lib/auth/session";
import { passwordProblem } from "@/lib/auth/users";
import { clientIp } from "@/lib/request";

export const dynamic = "force-dynamic";

/**
 * Parola değiştirme. CSRF kontrolü guardApi yerine burada elle yapılmıyor:
 * mevcut parolanın tekrar sorulması zaten CSRF'e karşı koruma sağlıyor.
 */
export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) {
    return Response.json({ error: serverT("api.auth.sessionRequired") }, { status: 401 });
  }

  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const currentPassword =
    typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  // Kural tek yerde (M3.1): yönetici sıfırlaması ve kullanıcının kendi
  // değiştirmesi aynı eşiği görmeli, yoksa biri diğerinin açığını kapatır.
  const problem = passwordProblem(newPassword);
  if (problem) return Response.json({ error: problem }, { status: 400 });

  if (newPassword === currentPassword) {
    return Response.json({ error: serverT("api.auth.passwordSame") }, { status: 400 });
  }

  const ip = clientIp(request);
  const check = attemptLogin(session.user.username, currentPassword, ip);
  if (!check.ok) {
    return Response.json({ error: serverT("api.auth.currentPasswordWrong") }, { status: 401 });
  }

  changePassword(session.user.id, newPassword);

  // Parola değişince diğer tüm oturumlar düşer (çalınmış oturum varsa kesilir).
  destroyAllSessionsForUser(session.user.id);

  audit({
    userId: session.user.id,
    username: session.user.username,
    action: "auth.password_change",
    ip,
    detail: serverT("api.auth.sessionsEnded"),
  });

  return Response.json({ ok: true });
}
