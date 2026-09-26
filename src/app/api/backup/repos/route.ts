import { serverT } from "@/lib/i18n/runtime";
import { enterHost, guardHostApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { checkRepo, initRepo } from "@/lib/backup/restic";
import {
  createRepo,
  deleteRepo,
  listJobs,
  listRepos,
  markRepoChecked,
  repoSecrets,
  updateRepo,
  validateRepo,
  type RepoInput,
} from "@/lib/backup/store";

export const dynamic = "force-dynamic";

export function backupPayload() {
  return { repos: listRepos(), jobs: listJobs() };
}

function parseInput(body: Record<string, unknown>): RepoInput {
  return {
    name: String(body.name ?? ""),
    kind: String(body.kind ?? "local"),
    location: String(body.location ?? ""),
    password: String(body.password ?? ""),
    env: String(body.env ?? ""),
  };
}

export async function POST(request: Request) {
  const guard = await guardHostApi(request, "backup.manage", { agent: true });
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const action = String(body.action ?? "create");

  // Depo doğrulama ve oluşturma: restic gerçekten çalıştırılıyor, "kaydedildi"
  // demekle yetinilmiyor. Yanlış parola ya da erişilemeyen yol, ilk gece
  // yarısında değil şimdi öğrenilmeli.
  if (action === "check" || action === "init") {
    const id = Number(body.id ?? 0);
    const secrets = repoSecrets(id);
    if (!secrets) {
      return Response.json(
        {
          error:
            serverT("api.backup.repoPasswordReenter"),
        },
        { status: 400 },
      );
    }

    const outcome = action === "init" ? await initRepo(secrets) : await checkRepo(secrets);
    markRepoChecked(id, outcome.initialized, outcome.ok ? "" : outcome.message);

    audit({
      userId: guard.session.user.id,
      username: guard.session.user.username,
      action: `backup.repo.${action}`,
      targetType: "backup_repo",
      targetId: String(id),
      detail: outcome.message,
      result: outcome.ok ? "ok" : "error",
    });

    return Response.json({ ok: outcome.ok, message: outcome.message, ...backupPayload() });
  }

  const input = parseInput(body);
  const problem = validateRepo(input, true);
  if (problem) return Response.json({ error: problem }, { status: 400 });

  const id = createRepo(input);

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "backup.repo.create",
    targetType: "backup_repo",
    targetId: String(id),
    detail: `${input.name} (${input.kind}) → ${input.location}`,
    result: "ok",
  });

  return Response.json({ ok: true, ...backupPayload() });
}

export async function PATCH(request: Request) {
  const guard = await guardHostApi(request, "backup.manage", { agent: true });
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const id = Number(body.id ?? 0);
  const input = parseInput(body);
  const problem = validateRepo(input, false);
  if (problem) return Response.json({ error: problem }, { status: 400 });

  if (!updateRepo(id, input)) {
    return Response.json({ error: serverT("api.notFound.repo") }, { status: 404 });
  }

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "backup.repo.update",
    targetType: "backup_repo",
    targetId: String(id),
    detail: input.password.length > 0 ? `${input.name} · ${serverT("api.backup.passwordChanged")}` : input.name,
    result: "ok",
  });

  return Response.json({ ok: true, ...backupPayload() });
}

export async function DELETE(request: Request) {
  const guard = await guardHostApi(request, "backup.manage", { agent: true });
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  const id = Number(new URL(request.url).searchParams.get("id") ?? 0);
  const outcome = deleteRepo(id);

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "backup.repo.delete",
    targetType: "backup_repo",
    targetId: String(id),
    detail: outcome.ok ? serverT("api.backup.repoDeleted") : (outcome.error ?? ""),
    result: outcome.ok ? "ok" : "error",
  });

  if (!outcome.ok) return Response.json({ error: outcome.error }, { status: 400 });
  return Response.json({ ok: true, ...backupPayload() });
}
