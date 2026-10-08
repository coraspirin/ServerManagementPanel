import { backupGuard, describe, fail, record } from "@/lib/backup/http";
import { jobContext, prepareDownload } from "@/lib/backup/restore";

export const dynamic = "force-dynamic";

/** Yedekten tek dosya ya da klasör (zip) indir — yalnızca panelin kendi sunucusu. */
export async function GET(request: Request) {
  const guard = await backupGuard(request);
  if (!guard.ok) return guard.response;
  const url = new URL(request.url);
  const context = jobContext(Number(url.searchParams.get("jobId") ?? 0));
  if ("error" in context) return fail(context.error, 404);

  const snapshotId = String(url.searchParams.get("snapshotId") ?? "");
  const entryPath = String(url.searchParams.get("path") ?? "");
  try {
    const file = await prepareDownload(context, snapshotId, entryPath, url.searchParams.get("dir") === "1");
    record(guard, "backup.download", `${snapshotId.slice(0, 8)} ${entryPath}`, {
      targetType: "backup_job",
      targetId: context.job.id,
    });
    return new Response(file.stream, {
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(file.size),
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return fail(describe(error), 400);
  }
}
