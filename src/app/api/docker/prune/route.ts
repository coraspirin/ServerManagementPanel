import { serverT } from "@/lib/i18n/runtime";
import { enterHost, guardHostApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { getDockerProvider } from "@/lib/providers";
import type { PruneScope } from "@/lib/providers/types";

export const dynamic = "force-dynamic";

const SCOPES: PruneScope[] = [
  "containers",
  "images-dangling",
  "images-unused",
  "volumes",
  "networks",
  "build-cache",
];

/**
 * Disk temizliği (M1.7).
 *
 * GERİ ALINAMAZ. Arayüz kapsam başına ne yapacağını açıkça yazar ve volume
 * temizliğinde ayrıca onay ister; burada da her çalıştırma, ne silindiğiyle
 * birlikte audit'e düşer.
 */
export async function POST(request: Request) {
  const guard = await guardHostApi(request, "docker.action", { agent: true });
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  let body: { scope?: unknown };
  try {
    body = (await request.json()) as { scope?: unknown };
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const scope = body.scope as PruneScope;
  if (!SCOPES.includes(scope)) {
    return Response.json({ error: serverT("api.docker.invalidScope") }, { status: 400 });
  }

  try {
    const result = await getDockerProvider().prune(scope);

    audit({
      userId: guard.session.user.id,
      username: guard.session.user.username,
      action: "docker.prune",
      targetId: scope,
      detail: serverT("api.docker.pruned", { removed: result.removed, mb: (result.reclaimedBytes / 1024 ** 2).toFixed(0) }),
      result: "ok",
    });

    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : serverT("api.unknownError");
    audit({
      userId: guard.session.user.id,
      username: guard.session.user.username,
      action: "docker.prune",
      targetId: scope,
      detail: message,
      result: "error",
    });
    return Response.json({ error: message }, { status: 500 });
  }
}
