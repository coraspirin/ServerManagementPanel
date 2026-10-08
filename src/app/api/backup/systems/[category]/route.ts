import { serverT } from "@/lib/i18n/runtime";
import { discoverDatabases, discoverDocker, discoverOs } from "@/lib/backup/discover";
import { backupGuard, describe, fail, invalid, readBody, record, settingsFrom } from "@/lib/backup/http";
import { upcomingRuns } from "@/lib/backup/scheduler";
import {
  getSystemJob,
  isSystemCategory,
  replaceSources,
  saveSystemJob,
  validateSystemSettings,
  type SourceInput,
} from "@/lib/backup/store/jobs";
import type { DbItem, DockerItem, OsItem, SystemCategory } from "@/lib/backup/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ category: string }> };

async function discover(category: SystemCategory): Promise<DockerItem[] | OsItem[] | DbItem[]> {
  if (category === "docker") return discoverDocker();
  if (category === "os") return discoverOs();
  return discoverDatabases();
}

/** Sistemin işi, otomatik bulunan öğeler ve sonraki çalışmalar. */
export async function GET(request: Request, { params }: Params) {
  const guard = await backupGuard(request);
  if (!guard.ok) return guard.response;
  const category = (await params).category;
  if (!isSystemCategory(category)) return fail(serverT("api.notFound.job"), 404);

  const job = getSystemJob(category);
  let items: DockerItem[] | OsItem[] | DbItem[] = [];
  let discoveryError: string | null = null;
  try {
    items = await discover(category);
  } catch (error) {
    discoveryError = describe(error);
  }
  return Response.json({
    job,
    items,
    discoveryError,
    upcoming: job?.enabled && job.scheduleCron ? upcomingRuns(job.scheduleCron, 3) : [],
  });
}

const OS_FORBIDDEN = /^\/(proc|sys|dev|run)(\/|$)/;

function sourcesFrom(category: SystemCategory, raw: unknown): SourceInput[] | null {
  if (!Array.isArray(raw)) return null;
  const sources: SourceInput[] = [];
  for (const entry of raw as Record<string, unknown>[]) {
    const selected = entry.selected === true;
    if (category === "docker") {
      const name = String(entry.name ?? "");
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) return null;
      sources.push({ kind: "container", ref: name, enabled: selected, options: { stop: entry.stop === true } });
    } else if (category === "os") {
      const path = String(entry.path ?? "").replace(/\/+$/, "");
      if (!path.startsWith("/") || path.includes("..") || OS_FORBIDDEN.test(path) || path === "") return null;
      sources.push({ kind: "host_dir", ref: path, enabled: selected });
    } else {
      const kind = entry.kind === "panel_db" ? "panel_db" : "db";
      const ref = kind === "panel_db" ? "" : String(entry.ref ?? "");
      if (kind === "db" && !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(ref)) return null;
      sources.push({ kind, ref, enabled: selected });
    }
  }
  return sources;
}

/** Ayarları ve (verildiyse) kapsam listesini kaydeder. */
export async function PUT(request: Request, { params }: Params) {
  const guard = await backupGuard(request);
  if (!guard.ok) return guard.response;
  const category = (await params).category;
  if (!isSystemCategory(category)) return fail(serverT("api.notFound.job"), 404);

  const body = await readBody(request);
  if (!body || !body.settings || typeof body.settings !== "object") return invalid();
  const settings = settingsFrom(body.settings as Record<string, unknown>);
  const error = validateSystemSettings(settings);
  if (error) return fail(error);

  let sources: SourceInput[] | null = null;
  if (body.items !== undefined) {
    sources = sourcesFrom(category, body.items);
    if (!sources) return invalid();
  }

  const jobId = saveSystemJob(category, settings);
  if (sources) replaceSources(jobId, sources);

  record(
    guard,
    "backup.system.update",
    `${category}: ${settings.scheduleCron || "-"} · keep ${settings.keepLast}/${settings.keepDaily}/${settings.keepWeekly}/${settings.keepMonthly}${sources ? ` · ${sources.filter((source) => source.enabled).length} items` : ""}`,
    { targetType: "backup_job", targetId: jobId },
  );
  return Response.json({ ok: true, job: getSystemJob(category) });
}
