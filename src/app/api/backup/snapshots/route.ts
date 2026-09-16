import { serverT } from "@/lib/i18n/runtime";
import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { tagFor } from "@/lib/backup/engine";
import { listSnapshotFiles, listSnapshots, runRestore } from "@/lib/backup/restic";
import { getJob, repoSecrets } from "@/lib/backup/store";

export const dynamic = "force-dynamic";

/**
 * Snapshot listeleme, içerik gözatma ve geri yükleme (M3.4).
 *
 * Geri yükleme yedekleme yolundaki TEK yazma işlemi ve üzerine yazma riski
 * taşıyor. Bu yüzden hedef dizin kullanıcıdan açıkça alınıyor, kaynağın
 * üzerine yazılmıyor: restic dosyaları hedefe açar, kullanıcı bakar ve
 * istediğini kendi taşır.
 */
export async function GET(request: Request) {
  const guard = await guardApi(request, "backup.manage");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const jobId = Number(url.searchParams.get("jobId") ?? 0);
  const job = getJob(jobId);
  if (!job) return Response.json({ error: serverT("api.notFound.job") }, { status: 404 });

  const secrets = repoSecrets(job.repoId);
  if (!secrets) {
    return Response.json(
      { error: serverT("api.backup.repoPasswordMaster") },
      { status: 400 },
    );
  }

  const snapshotId = url.searchParams.get("snapshotId");
  if (snapshotId) {
    return Response.json({ files: await listSnapshotFiles(secrets, snapshotId) });
  }

  return Response.json({ snapshots: await listSnapshots(secrets, tagFor(job)) });
}

export async function POST(request: Request) {
  const guard = await guardApi(request, "backup.manage");
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const job = getJob(Number(body.jobId ?? 0));
  if (!job) return Response.json({ error: serverT("api.notFound.job") }, { status: 404 });

  const snapshotId = String(body.snapshotId ?? "").trim();
  const target = String(body.target ?? "").trim();

  if (!snapshotId) return Response.json({ error: serverT("api.backup.snapshotRequired") }, { status: 400 });
  if (!target.startsWith("/") || target.includes("..")) {
    return Response.json(
      { error: serverT("api.backup.targetAbsolute") },
      { status: 400 },
    );
  }
  // Kök ve sistem dizinlerine geri yükleme, çalışan sistemin üzerine yazmak
  // demektir. Panelden yapılabilecek en yıkıcı işlem bu olurdu.
  if (["/", "/etc", "/usr", "/bin", "/sbin", "/boot", "/proc", "/sys", "/dev"].some(
    (forbidden) => target === forbidden || target.startsWith(`${forbidden}/`),
  )) {
    return Response.json(
      { error: serverT("api.backup.targetForbidden", { target }) },
      { status: 400 },
    );
  }

  const secrets = repoSecrets(job.repoId);
  if (!secrets) {
    return Response.json({ error: serverT("api.backup.repoPassword") }, { status: 400 });
  }

  const result = await runRestore(secrets, snapshotId, target);
  const ok = result.exitCode === 0;

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "backup.restore",
    targetType: "backup_job",
    targetId: String(job.id),
    detail: `${snapshotId.slice(0, 8)} → ${target}${ok ? "" : ` — ${result.output.slice(0, 300)}`}`,
    result: ok ? "ok" : "error",
  });

  return Response.json({
    ok,
    message: ok
      ? serverT("api.backup.restored", { id: snapshotId.slice(0, 8), target })
      : result.output.slice(0, 800),
  });
}
