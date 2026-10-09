import { serverT } from "@/lib/i18n/runtime";
import { completeSetup } from "@/lib/auth/setup";
import { createSession, setSessionCookies } from "@/lib/auth/session";
import { clientIp } from "@/lib/request";

export const dynamic = "force-dynamic";

/*
  Yanlış kod denemesi sınırı. Kod ~59 bit, kaba kuvvetle bulunamaz; bu sınır
  yalnızca logu gürültüden korur. Bellekte tutulması yeterli: sayaç ile kontrol
  aynı modülde, yeniden başlatma zaten yeni kod üretiyor.
*/
const MAX_FAILS = 10;
const WINDOW_MS = 15 * 60 * 1000;
const fails = new Map<string, { count: number; since: number }>();

function blocked(ip: string): boolean {
  const entry = fails.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.since > WINDOW_MS) {
    fails.delete(ip);
    return false;
  }
  return entry.count >= MAX_FAILS;
}

function recordFail(ip: string) {
  const entry = fails.get(ip);
  if (entry && Date.now() - entry.since <= WINDOW_MS) entry.count += 1;
  else fails.set(ip, { count: 1, since: Date.now() });
}

export async function POST(request: Request) {
  let body: { code?: unknown; username?: unknown; displayName?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const ip = clientIp(request);
  if (blocked(ip)) {
    return Response.json({ error: serverT("setup.errors.tooMany") }, { status: 429 });
  }

  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const result = completeSetup({
    code: str(body.code),
    username: str(body.username),
    displayName: str(body.displayName),
    password: str(body.password),
    ip,
  });

  if (!result.ok) {
    if (result.reason === "code") recordFail(ip);
    const status = result.reason === "done" ? 409 : result.reason === "code" ? 403 : 400;
    return Response.json({ error: result.error }, { status });
  }

  // Sihirbazı bitiren doğrudan içeride: aynı parolayı hemen tekrar yazdırmanın anlamı yok.
  const session = createSession(result.result.userId, {
    ip,
    userAgent: request.headers.get("user-agent") ?? "",
  });
  await setSessionCookies(session.token, session.csrfToken, session.expiresAt);

  return Response.json({ ok: true });
}
