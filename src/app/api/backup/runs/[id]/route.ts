import { serverT } from "@/lib/i18n/runtime";
import { backupGuard, fail, record } from "@/lib/backup/http";
import { cancelRun, liveRun } from "@/lib/backup/live";
import { getRun } from "@/lib/backup/store/runs";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Koşu ayrıntısı + log; sürüyorsa canlı ilerleme. */
export async function GET(request: Request, { params }: Params) {
  const guard = await backupGuard(request);
  if (!guard.ok) return guard.response;
  const id = Number((await params).id);
  const run = getRun(id);
  if (!run) return fail(serverT("api.notFound.run"), 404);
  return Response.json({ run, live: liveRun(id, guard.hostId) });
}

/** İptal: restic container'ı durdurulur, durdurulan container'lar yeniden başlatılır. */
export async function DELETE(request: Request, { params }: Params) {
  const guard = await backupGuard(request);
  if (!guard.ok) return guard.response;
  const id = Number((await params).id);
  if (!cancelRun(id, guard.hostId)) return fail(serverT("api.backup.notRunning"), 409);
  record(guard, "backup.cancel", `#${id}`, { targetType: "backup_run", targetId: id });
  return Response.json({ ok: true });
}
