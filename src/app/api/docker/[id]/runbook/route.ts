import { serverT } from "@/lib/i18n/runtime";
import { enterHost, guardHostApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { saveRunbook } from "@/lib/docker/runbooks";
import { getDockerProvider } from "@/lib/providers";

export const dynamic = "force-dynamic";

const MAX_BODY_CHARS = 20_000;

/**
 * Runbook notu yazma (M1.8).
 *
 * Not container ADINA bağlanır — id her recreate'te değişir, isim kalır. Bu
 * yüzden gelen id önce isme çözülüyor; kısa id ile yazılan bir not, uzun id
 * ile bakıldığında kaybolmasın.
 *
 * `docker.action` izni isteniyor, `settings.edit` değil: runbook bir panel
 * ayarı değil, o container hakkında işletme bilgisi.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardHostApi(request, "docker.action");
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  const id = (await params).id;

  let payload: { body?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  if (typeof payload.body !== "string") {
    return Response.json({ error: serverT("api.docker.noteRequired") }, { status: 400 });
  }
  if (payload.body.length > MAX_BODY_CHARS) {
    return Response.json(
      { error: serverT("api.docker.noteTooLong", { max: MAX_BODY_CHARS }) },
      { status: 400 },
    );
  }

  const state = await getDockerProvider().inspect(id);
  if (!state) return Response.json({ error: serverT("api.notFound.container") }, { status: 404 });

  const runbook = saveRunbook(
    "container",
    state.name,
    payload.body,
    guard.session.user.username,
  );

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: runbook ? "runbook.save" : "runbook.delete",
    targetType: "container",
    targetId: state.name,
    result: "ok",
  });

  return Response.json({ ok: true, runbook });
}
