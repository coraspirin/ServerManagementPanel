import { serverT } from "@/lib/i18n/runtime";
import { discoverDatabases, discoverDocker, discoverOs } from "@/lib/backup/discover";
import { startBackup } from "@/lib/backup/engine";
import { backupGuard, describe, fail, invalid, parseLocation, readBody, record } from "@/lib/backup/http";
import { replaceSources, saveSystemJob, validateSystemSettings, type SourceInput } from "@/lib/backup/store/jobs";
import { createRepo, getRepo, validateRepo } from "@/lib/backup/store/repos";
import { SYSTEM_CATEGORIES, type SystemCategory } from "@/lib/backup/types";

export const dynamic = "force-dynamic";

/**
 * "Yedeklemeyi kur" sihirbazı — tek istek: konum (yeni ya da var olan) +
 * açılacak sistemler + zamanlama. Kaynaklar otomatik bulunanlardan önerilen
 * hâliyle seçilir; kullanıcı sonradan her sistemin sekmesinden değiştirir.
 */
export async function POST(request: Request) {
  const guard = await backupGuard(request);
  if (!guard.ok) return guard.response;
  const body = await readBody(request);
  if (!body) return invalid();

  const systems = (Array.isArray(body.systems) ? body.systems : [])
    .map(String)
    .filter((value): value is SystemCategory => (SYSTEM_CATEGORIES as readonly string[]).includes(value));
  if (systems.length === 0) return fail(serverT("api.backup.noSystems"));

  // 1. Konum.
  let repoId = Number(body.locationId ?? 0);
  let password: string | null = null;
  if (repoId > 0) {
    if (!getRepo(repoId)) return fail(serverT("api.notFound.repo"), 404);
  } else {
    if (!body.location || typeof body.location !== "object") return invalid();
    const input = parseLocation(body.location as Record<string, unknown>);
    const error = validateRepo(input, true);
    if (error) return fail(error);
    const created = createRepo(input);
    repoId = created.id;
    password = input.password ? null : created.password;
    record(guard, "backup.location.create", `${input.name} (${input.kind}) ${input.location}`, {
      targetType: "backup_repo",
      targetId: repoId,
    });
  }

  // 2. Sistemler.
  const keepLast = Math.max(1, Math.min(1000, Number(body.keepLast ?? 7) || 7));
  const settings = {
    repoId,
    scheduleCron: String(body.scheduleCron ?? "0 2 * * *"),
    keepLast,
    keepDaily: 0,
    keepWeekly: 0,
    keepMonthly: 0,
    notifySuccess: body.notifySuccess === true,
    enabled: true,
    options: {},
  };
  const error = validateSystemSettings(settings);
  if (error) return fail(error);

  const jobIds: number[] = [];
  const warnings: string[] = [];
  for (const category of systems) {
    let sources: SourceInput[] = [];
    try {
      if (category === "docker") {
        sources = (await discoverDocker()).map((item) => ({
          kind: "container" as const,
          ref: item.name,
          enabled: item.selected,
          options: { stop: false },
        }));
      } else if (category === "os") {
        sources = (await discoverOs()).map((item) => ({ kind: "host_dir" as const, ref: item.path, enabled: item.selected }));
      } else {
        sources = (await discoverDatabases()).map((item) => ({
          kind: item.kind,
          ref: item.ref,
          enabled: item.selected && item.credentials !== "missing",
        }));
      }
    } catch (discoverError) {
      warnings.push(`${serverT(`backup.category.${category}`)}: ${describe(discoverError)}`);
    }
    const jobId = saveSystemJob(category, settings);
    replaceSources(jobId, sources);
    jobIds.push(jobId);
  }
  record(guard, "backup.setup", `${systems.join(", ")} → #${repoId} · ${settings.scheduleCron}`, {
    targetType: "backup_repo",
    targetId: repoId,
  });

  // 3. İlk yedek (konum kilidi sırayla çalıştırır).
  const runIds: number[] = [];
  if (body.runNow !== false) {
    for (const jobId of jobIds) {
      const started = startBackup(jobId, guard.session.user.username);
      if (started.ok) runIds.push(started.runId);
      else warnings.push(started.error);
    }
  }

  return Response.json({ locationId: repoId, password, jobIds, runIds, warnings }, { status: 201 });
}
