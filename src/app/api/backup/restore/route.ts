import { backupGuard, fail, invalid, readBody, record } from "@/lib/backup/http";
import { parseRestoreRequest, startRestore } from "@/lib/backup/restore";

export const dynamic = "force-dynamic";

/**
 * Geri yükleme — arka planda; koşu kimliği döner, ilerleme canlı akışta.
 * Modlar: yeni klasöre çıkar · orijinal yerine (OS) · container · veritabanı.
 */
export async function POST(request: Request) {
  const guard = await backupGuard(request);
  if (!guard.ok) return guard.response;
  const body = await readBody(request);
  if (!body) return invalid();

  const parsed = parseRestoreRequest(body);
  if (typeof parsed === "string") return fail(parsed);

  const jobId = Number(body.jobId ?? 0);
  const started = startRestore(jobId, parsed, guard.session.user.username);
  if (!started.ok) return fail(started.error, 409);

  const target =
    parsed.mode === "folder" ? parsed.target : parsed.mode === "original" ? "/" : parsed.container;
  record(guard, "backup.restore", `${parsed.mode} ${parsed.snapshotId.slice(0, 8)} → ${target}`, {
    targetType: "backup_job",
    targetId: jobId,
  });
  return Response.json({ runId: started.runId }, { status: 202 });
}
