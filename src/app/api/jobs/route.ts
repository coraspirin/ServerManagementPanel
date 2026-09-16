import { serverT } from "@/lib/i18n/runtime";
import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { jobStatuses, runJobNow } from "@/lib/jobs/runner";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await guardApi(request, "settings.view");
  if (!guard.ok) return guard.response;

  return Response.json({ jobs: jobStatuses() });
}

/** Bir işi elle tetikler — sorun ayıklarken beklemeye gerek kalmasın. */
export async function POST(request: Request) {
  const guard = await guardApi(request, "settings.edit");
  if (!guard.ok) return guard.response;

  let body: { key?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  if (typeof body.key !== "string") {
    return Response.json({ error: serverT("api.keyRequired") }, { status: 400 });
  }

  const result = await runJobNow(body.key);

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "jobs.run",
    targetId: body.key,
    detail: result.detail,
    result: result.ok ? "ok" : "error",
  });

  return Response.json({ ok: result.ok, detail: result.detail, jobs: jobStatuses() });
}
