import "server-only";

import { audit } from "@/lib/auth/audit";
import { enterHost, guardHostApi } from "@/lib/auth/api";
import { serverT } from "@/lib/i18n/runtime";
import type { CustomJobInput, SystemSettingsInput } from "./store/jobs";
import { uniqueRepoName, type RepoInput } from "./store/repos";

/** Yedekleme API rotalarının ortak parçaları. */

export async function backupGuard(request: Request) {
  const guard = await guardHostApi(request, "backup.manage", { agent: true });
  if (guard.ok) enterHost(guard.hostId);
  return guard;
}

export type GuardOk = Extract<Awaited<ReturnType<typeof backupGuard>>, { ok: true }>;

export async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function fail(error: string, status = 400): Response {
  return Response.json({ error }, { status });
}

export function invalid(): Response {
  return fail(serverT("api.invalidRequest"));
}

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function record(
  guard: GuardOk,
  action: string,
  detail: string,
  options: { targetType?: string; targetId?: string | number; ok?: boolean } = {},
): void {
  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action,
    targetType: options.targetType,
    targetId: options.targetId === undefined ? undefined : String(options.targetId),
    detail,
    result: options.ok === false ? "error" : "ok",
  });
}

/** İstek gövdesinden konum girdisi (yalnızca BÜYÜK_HARF ortam anahtarları). */
export function parseLocation(body: Record<string, unknown>): RepoInput {
  const env: Record<string, string> = {};
  if (body.env && typeof body.env === "object") {
    for (const [key, value] of Object.entries(body.env as Record<string, unknown>)) {
      if (/^[A-Z][A-Z0-9_]*$/.test(key)) env[key] = String(value ?? "");
    }
  }
  const options = (body.options && typeof body.options === "object" ? body.options : {}) as Record<string, unknown>;
  const location = String(body.location ?? "");
  // Ad verilmezse adresten türetilir: "/mnt/yedek" → "yedek", "//nas/pay" → "pay".
  const fallback = location.replace(/^(s3|rclone):/, "").split(/[/:]/).filter(Boolean).pop() ?? "";
  return {
    name: String(body.name ?? "").trim() || uniqueRepoName(fallback || "yedek"),
    kind: String(body.kind ?? "local"),
    location,
    password: String(body.password ?? ""),
    env,
    options: { limitUploadKb: Number(options.limitUploadKb ?? 0), limitDownloadKb: Number(options.limitDownloadKb ?? 0) },
  };
}

/** İstek gövdesinden sistem ayarları. */
export function settingsFrom(body: Record<string, unknown>): SystemSettingsInput {
  const options = (body.options && typeof body.options === "object" ? body.options : {}) as Record<string, unknown>;
  return {
    repoId: Number(body.repoId ?? 0),
    scheduleCron: String(body.scheduleCron ?? ""),
    keepLast: Number(body.keepLast ?? 0),
    keepDaily: Number(body.keepDaily ?? 0),
    keepWeekly: Number(body.keepWeekly ?? 0),
    keepMonthly: Number(body.keepMonthly ?? 0),
    notifySuccess: body.notifySuccess === true,
    enabled: body.enabled !== false,
    options: {
      ...(typeof options.autoInclude === "boolean" ? { autoInclude: options.autoInclude } : {}),
      ...(typeof options.retry === "boolean" ? { retry: options.retry } : {}),
      ...(typeof options.spaceCheck === "boolean" ? { spaceCheck: options.spaceCheck } : {}),
      ...(typeof options.lowPriority === "boolean" ? { lowPriority: options.lowPriority } : {}),
      ...(typeof options.anomaly === "boolean" ? { anomaly: options.anomaly } : {}),
      ...(Array.isArray(options.excludes) ? { excludes: options.excludes.map(String) } : {}),
    },
  };
}

/** İstek gövdesinden özel iş girdisi. */
export function customJobFrom(body: Record<string, unknown>): CustomJobInput {
  return {
    name: String(body.name ?? ""),
    repoId: Number(body.repoId ?? 0),
    sourceKind: String(body.sourceKind ?? "host_dir"),
    source: String(body.source ?? ""),
    scheduleCron: String(body.scheduleCron ?? ""),
    quiesce: String(body.quiesce ?? ""),
    excludes: String(body.excludes ?? ""),
    keepLast: Number(body.keepLast ?? 0),
    keepDaily: Number(body.keepDaily ?? 0),
    keepWeekly: Number(body.keepWeekly ?? 0),
    keepMonthly: Number(body.keepMonthly ?? 0),
    notifySuccess: body.notifySuccess === true,
    enabled: body.enabled !== false,
  };
}
