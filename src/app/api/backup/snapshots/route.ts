import { backupGuard, describe, fail, record } from "@/lib/backup/http";
import { downloadSupported, forgetSnapshot, jobContext, listJobSnapshots } from "@/lib/backup/restore";

export const dynamic = "force-dynamic";

/** Bir işin yedekleri (snapshot'lar), en yeni önce. */
export async function GET(request: Request) {
  const guard = await backupGuard(request);
  if (!guard.ok) return guard.response;
  const context = jobContext(Number(new URL(request.url).searchParams.get("jobId") ?? 0));
  if ("error" in context) return fail(context.error, 404);
  try {
    return Response.json({ snapshots: await listJobSnapshots(context), downloadSupported: downloadSupported() });
  } catch (error) {
    return fail(describe(error), 502);
  }
}

/** Tek yedeği siler (forget + prune). */
export async function DELETE(request: Request) {
  const guard = await backupGuard(request);
  if (!guard.ok) return guard.response;
  const url = new URL(request.url);
  const context = jobContext(Number(url.searchParams.get("jobId") ?? 0));
  if ("error" in context) return fail(context.error, 404);
  const snapshotId = String(url.searchParams.get("snapshotId") ?? "");
  try {
    await forgetSnapshot(context, snapshotId);
    record(guard, "backup.snapshot.delete", `${context.job.name} ${snapshotId.slice(0, 8)}`, {
      targetType: "backup_job",
      targetId: context.job.id,
    });
    return Response.json({ ok: true });
  } catch (error) {
    return fail(describe(error), 400);
  }
}
