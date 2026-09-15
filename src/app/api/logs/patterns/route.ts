import { guardApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import {
  createPattern,
  deletePattern,
  listPatterns,
  updatePattern,
  validatePattern,
  type PatternInput,
} from "@/lib/logs/store";

export const dynamic = "force-dynamic";

const SEVERITIES = new Set(["info", "warning", "critical"]);

function parseInput(body: Record<string, unknown>): PatternInput {
  const severity = String(body.severity ?? "warning");
  return {
    name: String(body.name ?? ""),
    pattern: String(body.pattern ?? ""),
    isRegex: Boolean(body.isRegex),
    sourceFilter: String(body.sourceFilter ?? ""),
    severity: (SEVERITIES.has(severity) ? severity : "warning") as PatternInput["severity"],
    enabled: body.enabled !== false,
    cooldownMinutes: Number(body.cooldownMinutes ?? 30),
  };
}

/**
 * Desen kuralları. `settings.edit` isteniyor, `logs.view` değil: bir kural
 * bildirim üretiyor, yani telefonu çaldırıyor. Okuma yetkisi olan herkesin
 * alarm tanımlayabilmesi doğru olmaz.
 */
export async function POST(request: Request) {
  const guard = await guardApi(request, "settings.edit");
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "geçersiz istek" }, { status: 400 });
  }

  const input = parseInput(body);
  const problem = validatePattern(input);
  if (problem) return Response.json({ error: problem }, { status: 400 });

  const id = createPattern(input);

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "logs.pattern.create",
    targetType: "log_pattern",
    targetId: String(id),
    detail: `${input.name} — ${input.pattern}`,
    result: "ok",
  });

  return Response.json({ ok: true, patterns: listPatterns() });
}

export async function PATCH(request: Request) {
  const guard = await guardApi(request, "settings.edit");
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "geçersiz istek" }, { status: 400 });
  }

  const id = Number(body.id ?? 0);
  const input = parseInput(body);
  const problem = validatePattern(input);
  if (problem) return Response.json({ error: problem }, { status: 400 });

  if (!updatePattern(id, input)) {
    return Response.json({ error: "Kural bulunamadı." }, { status: 404 });
  }

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "logs.pattern.update",
    targetType: "log_pattern",
    targetId: String(id),
    detail: `${input.name} — ${input.enabled ? "açık" : "kapalı"}`,
    result: "ok",
  });

  return Response.json({ ok: true, patterns: listPatterns() });
}

export async function DELETE(request: Request) {
  const guard = await guardApi(request, "settings.edit");
  if (!guard.ok) return guard.response;

  const id = Number(new URL(request.url).searchParams.get("id") ?? 0);
  if (!deletePattern(id)) {
    return Response.json({ error: "Kural bulunamadı." }, { status: 404 });
  }

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "logs.pattern.delete",
    targetType: "log_pattern",
    targetId: String(id),
    result: "ok",
  });

  return Response.json({ ok: true, patterns: listPatterns() });
}
