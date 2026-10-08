import { backupGuard, fail, invalid, parseLocation, readBody, record } from "@/lib/backup/http";
import { createRepo, listRepos, validateRepo } from "@/lib/backup/store/repos";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await backupGuard(request);
  if (!guard.ok) return guard.response;
  return Response.json({ locations: listRepos() });
}

/** Yeni konum. Parola verilmezse üretilir ve yanıtta BİR KEZ döner. */
export async function POST(request: Request) {
  const guard = await backupGuard(request);
  if (!guard.ok) return guard.response;
  const body = await readBody(request);
  if (!body) return invalid();

  const input = parseLocation(body);
  const error = validateRepo(input, true);
  if (error) return fail(error);

  const created = createRepo(input);
  record(guard, "backup.location.create", `${input.name} (${input.kind}) ${input.location}`, {
    targetType: "backup_repo",
    targetId: created.id,
  });
  return Response.json({ id: created.id, password: input.password ? null : created.password }, { status: 201 });
}
