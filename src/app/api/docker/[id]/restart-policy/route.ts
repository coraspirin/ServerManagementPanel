import { serverT } from "@/lib/i18n/runtime";
import { enterHost, guardHostApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { getDockerProvider } from "@/lib/providers";
import type { RestartPolicy } from "@/lib/providers/types";

export const dynamic = "force-dynamic";

const POLICIES: RestartPolicy["name"][] = ["no", "always", "unless-stopped", "on-failure"];

/**
 * Restart politikası değiştirme (M1.8).
 *
 * Docker'ın `/update` ucu bunu container'ı YENİDEN OLUŞTURMADAN uygular —
 * çalışan servis kesintiye uğramaz. Env, port ve mount değişiklikleri ise
 * recreate ister; onlar burada değil, compose yönetiminde (M1.12) yeri.
 *
 * Compose ile yönetilen bir container'da bu değişiklik bir sonraki
 * `compose up`'ta geri alınır; istemci bunu kullanıcıya söylüyor.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardHostApi(request, "docker.action", { agent: true });
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  const id = (await params).id;

  let payload: { name?: unknown; maximumRetryCount?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const name = payload.name as RestartPolicy["name"];
  if (!POLICIES.includes(name)) {
    return Response.json({ error: serverT("api.docker.invalidPolicy") }, { status: 400 });
  }

  const retry = Number(payload.maximumRetryCount ?? 0);
  if (!Number.isInteger(retry) || retry < 0 || retry > 100) {
    return Response.json({ error: serverT("api.docker.retryRange") }, { status: 400 });
  }

  const policy: RestartPolicy = { name, maximumRetryCount: retry };

  try {
    await getDockerProvider().setRestartPolicy(id, policy);
  } catch (error) {
    const message = error instanceof Error ? error.message : serverT("api.unknownError");
    audit({
      userId: guard.session.user.id,
      username: guard.session.user.username,
      action: "docker.restart_policy",
      targetId: id,
      detail: message,
      result: "error",
    });
    return Response.json({ error: message }, { status: 500 });
  }

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "docker.restart_policy",
    targetId: id,
    detail: name === "on-failure" ? `on-failure (${serverT("api.docker.maxRetries", { retry })})` : name,
    result: "ok",
  });

  return Response.json({ ok: true, policy });
}
