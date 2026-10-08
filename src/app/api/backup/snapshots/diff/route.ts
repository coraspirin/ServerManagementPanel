import { backupGuard, describe, fail } from "@/lib/backup/http";
import { diffSnapshots, jobContext } from "@/lib/backup/restore";

export const dynamic = "force-dynamic";

/** İki yedeği karşılaştır: eklenen / silinen / değişen. */
export async function GET(request: Request) {
  const guard = await backupGuard(request);
  if (!guard.ok) return guard.response;
  const url = new URL(request.url);
  const context = jobContext(Number(url.searchParams.get("jobId") ?? 0));
  if ("error" in context) return fail(context.error, 404);
  try {
    return Response.json(
      await diffSnapshots(context, String(url.searchParams.get("from") ?? ""), String(url.searchParams.get("to") ?? "")),
    );
  } catch (error) {
    return fail(describe(error), 400);
  }
}
