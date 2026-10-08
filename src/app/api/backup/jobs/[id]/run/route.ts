import { startBackup } from "@/lib/backup/engine";
import { backupGuard, fail, record } from "@/lib/backup/http";

export const dynamic = "force-dynamic";

/** "Şimdi yedekle": koşu kimliği hemen döner, ilerleme /api/backup/live'da. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await backupGuard(request);
  if (!guard.ok) return guard.response;
  const id = Number((await params).id);

  const started = startBackup(id, guard.session.user.username);
  if (!started.ok) return fail(started.error, 409);
  record(guard, "backup.run", `#${id}`, { targetType: "backup_job", targetId: id });
  return Response.json({ runId: started.runId }, { status: 202 });
}
