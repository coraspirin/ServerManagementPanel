import { serverT } from "@/lib/i18n/runtime";
import { backupGuard, customJobFrom, fail, invalid, readBody, record } from "@/lib/backup/http";
import { isJobActive } from "@/lib/backup/live";
import { deleteJob, getJob, setJobEnabled, updateCustomJob, validateCustomJob } from "@/lib/backup/store/jobs";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  const guard = await backupGuard(request);
  if (!guard.ok) return guard.response;
  const id = Number((await params).id);
  const job = getJob(id);
  if (!job || job.category !== "custom") return fail(serverT("api.notFound.job"), 404);

  const body = await readBody(request);
  if (!body) return invalid();
  const input = customJobFrom(body);
  const error = validateCustomJob(input, id);
  if (error) return fail(error);

  updateCustomJob(id, input);
  record(guard, "backup.job.update", input.name, { targetType: "backup_job", targetId: id });
  return Response.json({ ok: true });
}

/** Aç/kapat — sistem işleri ve özel işler için. */
export async function PATCH(request: Request, { params }: Params) {
  const guard = await backupGuard(request);
  if (!guard.ok) return guard.response;
  const id = Number((await params).id);
  const job = getJob(id);
  if (!job) return fail(serverT("api.notFound.job"), 404);

  const body = await readBody(request);
  if (!body || typeof body.enabled !== "boolean") return invalid();
  setJobEnabled(id, body.enabled);
  record(guard, body.enabled ? "backup.job.enable" : "backup.job.disable", job.name, {
    targetType: "backup_job",
    targetId: id,
  });
  return Response.json({ ok: true });
}

/**
 * İşi siler. Yedekler (snapshot'lar) konumda KALIR — kayıt silinir, veri değil;
 * aynı sistem yeniden kurulursa etiketi aynı olduğundan eski yedekler görünür.
 */
export async function DELETE(request: Request, { params }: Params) {
  const guard = await backupGuard(request);
  if (!guard.ok) return guard.response;
  const id = Number((await params).id);
  const job = getJob(id);
  if (!job) return fail(serverT("api.notFound.job"), 404);
  if (isJobActive(id)) return fail(serverT("backupEngine.alreadyRunning"), 409);

  deleteJob(id);
  record(guard, "backup.job.delete", job.name, { targetType: "backup_job", targetId: id });
  return Response.json({ ok: true });
}
