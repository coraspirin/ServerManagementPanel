import { backupGuard } from "@/lib/backup/http";
import { listRuns } from "@/lib/backup/store/runs";
import type { Category, RunKind, RunStatus } from "@/lib/backup/types";

export const dynamic = "force-dynamic";

const CATEGORIES = new Set(["docker", "os", "database", "custom"]);
const KINDS = new Set(["backup", "restore", "verify"]);
const STATUSES = new Set(["running", "ok", "warning", "error", "cancelled"]);

/** Geçmiş — filtreli, sayfalı. */
export async function GET(request: Request) {
  const guard = await backupGuard(request);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const pick = (key: string, allowed: Set<string>) => {
    const value = url.searchParams.get(key);
    return value && allowed.has(value) ? value : undefined;
  };
  const jobId = Number(url.searchParams.get("jobId") ?? 0);

  return Response.json(
    listRuns({
      jobId: jobId > 0 ? jobId : undefined,
      category: pick("category", CATEGORIES) as Category | undefined,
      kind: pick("kind", KINDS) as RunKind | undefined,
      status: pick("status", STATUSES) as RunStatus | undefined,
      limit: Number(url.searchParams.get("limit") ?? 50),
      offset: Number(url.searchParams.get("offset") ?? 0),
    }),
  );
}
