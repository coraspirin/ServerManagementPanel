import { serverT } from "@/lib/i18n/runtime";
import { guardApi } from "@/lib/auth/api";
import {
  deleteCron,
  forbiddenCommand,
  readCron,
  saveCron,
  type CronInput,
} from "@/lib/hostcron";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await guardApi(request, "cron.manage");
  if (!guard.ok) return guard.response;

  return Response.json(await readCron());
}

export async function POST(request: Request) {
  const guard = await guardApi(request, "cron.manage");
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const actor = { username: guard.session.user.username, userId: guard.session.user.id };

  /*
    Hata alanı tek biçimli: başarısızlık her zaman `error` taşır. İstemcinin
    iki farklı alana bakmak zorunda kalması, birini unutunca "sebepsiz hata"
    gösterilmesi demek olurdu.

    YAYMA SIRASI ÖNEMLİ: `readCron()` kendi `error` alanını (okuma hatası,
    normalde null) taşıyor. Sonra yayılsaydı işlem hatasının üzerine yazardı —
    tam olarak bu yaşandı ve doğrulama hataları boş görünüyordu.
  */
  const respond = (outcome: { ok: boolean; message: string }, state: object) =>
    Response.json(
      outcome.ok
        ? { ...state, ok: true, message: outcome.message }
        : { ...state, ok: false, error: outcome.message },
      { status: outcome.ok ? 200 : 400 },
    );

  if (body.action === "delete") {
    const outcome = await deleteCron(String(body.name ?? ""), actor);
    return respond(outcome, await readCron());
  }

  const input: CronInput = {
    name: String(body.name ?? ""),
    schedule: String(body.schedule ?? ""),
    user: String(body.user ?? "root"),
    command: String(body.command ?? ""),
    comment: String(body.comment ?? ""),
    enabled: body.enabled !== false,
  };

  const forbidden = forbiddenCommand(input.command);
  if (forbidden) return Response.json({ error: forbidden }, { status: 400 });

  const outcome = await saveCron(input, actor);
  return respond(outcome, await readCron());
}
