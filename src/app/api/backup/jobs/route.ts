import { backupGuard, customJobFrom, fail, invalid, readBody, record } from "@/lib/backup/http";
import { createCustomJob, validateCustomJob } from "@/lib/backup/store/jobs";

export const dynamic = "force-dynamic";

/** Özel (elle tanımlı, tek kaynaklı) iş — "Gelişmiş" bölümü. */
export async function POST(request: Request) {
  const guard = await backupGuard(request);
  if (!guard.ok) return guard.response;
  const body = await readBody(request);
  if (!body) return invalid();

  const input = customJobFrom(body);
  const error = validateCustomJob(input);
  if (error) return fail(error);

  const id = createCustomJob(input);
  record(guard, "backup.job.create", `${input.name}: ${input.sourceKind} ${input.source}`, {
    targetType: "backup_job",
    targetId: id,
  });
  return Response.json({ id }, { status: 201 });
}
