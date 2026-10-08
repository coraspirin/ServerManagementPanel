import { serverT } from "@/lib/i18n/runtime";
import { backupGuard, fail, invalid, parseLocation, readBody, record } from "@/lib/backup/http";
import { forgetMountVolume } from "@/lib/backup/runner";
import { deleteRepo, getRepo, updateRepo, validateRepo } from "@/lib/backup/store/repos";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  const guard = await backupGuard(request);
  if (!guard.ok) return guard.response;
  const id = Number((await params).id);
  const current = getRepo(id);
  if (!current) return fail(serverT("api.notFound.repo"), 404);

  const body = await readBody(request);
  if (!body) return invalid();
  const input = parseLocation(body);
  const error = validateRepo(input, false);
  if (error) return fail(error);

  updateRepo(id, input);
  // Ağ paylaşımının bağlantı seçenekleri volume'e gömülü; değişiklik bir
  // sonraki koşuda yeni volume'le geçerli olsun.
  if (current.kind === "smb" || current.kind === "nfs") await forgetMountVolume(id);

  record(guard, "backup.location.update", `${input.name} (${input.kind}) ${input.location}`, {
    targetType: "backup_repo",
    targetId: id,
  });
  return Response.json({ ok: true });
}

export async function DELETE(request: Request, { params }: Params) {
  const guard = await backupGuard(request);
  if (!guard.ok) return guard.response;
  const id = Number((await params).id);
  const current = getRepo(id);
  if (!current) return fail(serverT("api.notFound.repo"), 404);

  const result = deleteRepo(id);
  if (!result.ok) return fail(result.error ?? serverT("api.invalidRequest"), 409);
  if (current.kind === "smb" || current.kind === "nfs") await forgetMountVolume(id);

  record(guard, "backup.location.delete", current.name, { targetType: "backup_repo", targetId: id });
  return Response.json({ ok: true });
}
