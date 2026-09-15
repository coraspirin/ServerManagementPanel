import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { runBackupJob } from "@/lib/backup/engine";
import {
  createJob,
  deleteJob,
  listRuns,
  updateJob,
  validateJob,
  type JobInput,
} from "@/lib/backup/store";
import { backupPayload } from "../repos/route";

export const dynamic = "force-dynamic";

function parseInput(body: Record<string, unknown>): JobInput {
  return {
    name: String(body.name ?? ""),
    repoId: Number(body.repoId ?? 0),
    sourceKind: String(body.sourceKind ?? "volume"),
    source: String(body.source ?? ""),
    scheduleCron: String(body.scheduleCron ?? ""),
    quiesce: String(body.quiesce ?? ""),
    excludes: String(body.excludes ?? ""),
    keepDaily: Number(body.keepDaily ?? 7),
    keepWeekly: Number(body.keepWeekly ?? 4),
    keepMonthly: Number(body.keepMonthly ?? 6),
    enabled: body.enabled !== false,
  };
}

export async function GET(request: Request) {
  const guard = await guardApi(request, "backup.manage");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");

  return Response.json({
    ...backupPayload(),
    runs: listRuns(50, jobId ? Number(jobId) : undefined),
  });
}

export async function POST(request: Request) {
  const guard = await guardApi(request, "backup.manage");
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "geçersiz istek" }, { status: 400 });
  }

  // "Şimdi çalıştır": zamanlanmış turu beklemeden. Yedeklemenin çalıştığını
  // görmek, tanımlandıktan hemen sonra mümkün olmalı.
  if (body.action === "run") {
    const id = Number(body.id ?? 0);
    const outcome = await runBackupJob(id, guard.session.user.username);

    audit({
      userId: guard.session.user.id,
      username: guard.session.user.username,
      action: "backup.run",
      targetType: "backup_job",
      targetId: String(id),
      detail: outcome.detail,
      result: outcome.ok ? "ok" : "error",
    });

    return Response.json({
      ok: outcome.ok,
      message: outcome.detail,
      ...backupPayload(),
      runs: listRuns(50),
    });
  }

  const input = parseInput(body);
  const problem = validateJob(input);
  if (problem) return Response.json({ error: problem }, { status: 400 });

  const id = createJob(input);

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "backup.job.create",
    targetType: "backup_job",
    targetId: String(id),
    detail: `${input.name} — ${input.sourceKind}:${input.source}`,
    result: "ok",
  });

  return Response.json({ ok: true, ...backupPayload(), runs: listRuns(50) });
}

export async function PATCH(request: Request) {
  const guard = await guardApi(request, "backup.manage");
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "geçersiz istek" }, { status: 400 });
  }

  const id = Number(body.id ?? 0);
  const input = parseInput(body);
  const problem = validateJob(input);
  if (problem) return Response.json({ error: problem }, { status: 400 });

  if (!updateJob(id, input)) {
    return Response.json({ error: "İş bulunamadı." }, { status: 404 });
  }

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "backup.job.update",
    targetType: "backup_job",
    targetId: String(id),
    detail: `${input.name} · ${input.enabled ? "açık" : "kapalı"}`,
    result: "ok",
  });

  return Response.json({ ok: true, ...backupPayload(), runs: listRuns(50) });
}

export async function DELETE(request: Request) {
  const guard = await guardApi(request, "backup.manage");
  if (!guard.ok) return guard.response;

  const id = Number(new URL(request.url).searchParams.get("id") ?? 0);
  if (!deleteJob(id)) return Response.json({ error: "İş bulunamadı." }, { status: 404 });

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "backup.job.delete",
    targetType: "backup_job",
    targetId: String(id),
    // Snapshot'lar depoda kalıyor: iş tanımını silmek veriyi silmek değil.
    detail: "iş silindi (depodaki snapshot'lar duruyor)",
    result: "ok",
  });

  return Response.json({ ok: true, ...backupPayload(), runs: listRuns(50) });
}
