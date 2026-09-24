import { serverT } from "@/lib/i18n/runtime";
import { enterHost, guardHostApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { collectLogs } from "@/lib/logs/collect";
import { listPatterns, searchLogs } from "@/lib/logs/store";
import type { LogKind, LogLevel } from "@/lib/logs/types";

export const dynamic = "force-dynamic";

const LEVELS: LogLevel[] = ["debug", "info", "warning", "error"];

function parseSearch(url: URL) {
  const list = (key: string): string[] =>
    (url.searchParams.get(key) ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

  const num = (key: string): number | undefined => {
    const raw = url.searchParams.get(key);
    if (!raw) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };

  const kind = url.searchParams.get("kind");

  return {
    q: url.searchParams.get("q")?.trim() || undefined,
    sources: list("sources"),
    levels: list("levels").filter((level): level is LogLevel =>
      LEVELS.includes(level as LogLevel),
    ),
    kind: kind === "container" || kind === "journald" ? (kind as LogKind) : undefined,
    since: num("since"),
    until: num("until"),
    limit: num("limit"),
    offset: num("offset"),
  };
}

export async function GET(request: Request) {
  const guard = await guardHostApi(request, "logs.view");
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  const url = new URL(request.url);
  const result = searchLogs(parseSearch(url));

  if (url.searchParams.get("format") === "txt") {
    // Düz metin dışa aktarım: kopyalanıp bir hata raporuna yapıştırılabilsin.
    // En eskiden yeniye sıralanıyor — okurken doğal sıra bu.
    const body = [...result.records]
      .reverse()
      .map(
        (record) =>
          `${new Date(record.ts * 1000).toISOString()} [${record.source}] ` +
          `${record.level.toUpperCase()} ${record.message}`,
      )
      .join("\n");

    return new Response(body, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="loglar-${new Date()
          .toISOString()
          .slice(0, 10)}.txt"`,
      },
    });
  }

  return Response.json({ ...result, patterns: listPatterns() });
}

/** Elle toplama — zamanlanmış turu beklemeden "şimdi topla". */
export async function POST(request: Request) {
  const guard = await guardHostApi(request, "logs.view");
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  const outcome = await collectLogs();

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "logs.collect",
    detail: serverT("api.logs.collected", { lines: outcome.collected, sources: outcome.sources }),
    result: outcome.errors.length > 0 ? "error" : "ok",
  });

  return Response.json({ ok: true, outcome, ...searchLogs({ limit: 200 }) });
}
