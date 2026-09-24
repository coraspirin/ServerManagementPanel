import { serverT } from "@/lib/i18n/runtime";
import { enterHost, guardHostApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { dockerOverview } from "@/lib/docker/view";
import { getDockerProvider } from "@/lib/providers";
import type { ContainerAction } from "@/lib/providers/types";
import { getNumber } from "@/lib/settings";

export const dynamic = "force-dynamic";

const ALLOWED: ContainerAction[] = ["start", "stop", "restart", "pause", "unpause"];

/**
 * Container aksiyonu (M1.7).
 *
 * Her çağrı audit'e düşer — sonuçtan bağımsız olarak. "Neden bu servis gece
 * 3'te yeniden başladı?" sorusunun cevabı bir yerde yazılı olmalı.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardHostApi(request, "docker.action");
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  const id = (await params).id;

  let body: { action?: unknown };
  try {
    body = (await request.json()) as { action?: unknown };
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const action = body.action as ContainerAction;
  if (!ALLOWED.includes(action)) {
    return Response.json({ error: serverT("api.invalidAction") }, { status: 400 });
  }

  try {
    await getDockerProvider().action(id, action, getNumber("docker.stop_timeout"));
  } catch (error) {
    const message = error instanceof Error ? error.message : serverT("api.unknownError");
    audit({
      userId: guard.session.user.id,
      username: guard.session.user.username,
      action: `docker.${action}`,
      targetId: id,
      detail: message,
      result: "error",
    });
    return Response.json({ error: message }, { status: 500 });
  }

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: `docker.${action}`,
    targetId: id,
    result: "ok",
  });

  return Response.json({ ok: true, ...(await dockerOverview()) });
}
