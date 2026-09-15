import { guardApi } from "@/lib/auth/api";
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
  const guard = await guardApi(request, "docker.action");
  if (!guard.ok) return guard.response;

  const id = (await params).id;

  let payload: { body?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return Response.json({ error: "geçersiz istek" }, { status: 400 });
  }

  if (typeof payload.body !== "string") {
    return Response.json({ error: "not metni gerekli" }, { status: 400 });
  }
  if (payload.body.length > MAX_BODY_CHARS) {
    return Response.json(
      { error: `Not en fazla ${MAX_BODY_CHARS} karakter olabilir.` },
      { status: 400 },
    );
  }

  const state = await getDockerProvider().inspect(id);
  if (!state) return Response.json({ error: "container bulunamadı" }, { status: 404 });

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
