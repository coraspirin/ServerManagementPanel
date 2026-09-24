import { serverT } from "@/lib/i18n/runtime";
import { enterHost, guardHostApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { hasPermission } from "@/lib/auth/session";
import { readTable, runQuery } from "@/lib/dbadmin";
import { analyzeSql } from "@/lib/dbadmin/sql-guard";
import { connectionSecrets, listHistory, recordQuery } from "@/lib/dbadmin/store";

export const dynamic = "force-dynamic";

/**
 * Sorgu çalıştırma (M3.6).
 *
 * `db.read` yeterli — çünkü YAZMA kontrolü sorgunun kendisine bakılarak
 * yapılıyor: yazan bir ifade hem `db.write` iznini hem bağlantının
 * "yazılabilir" bayrağını gerektiriyor. Böylece okuma yetkisi olan biri
 * SELECT çalıştırabiliyor ama yanlışlıkla bile UPDATE atamıyor.
 */
export async function POST(request: Request) {
  const guard = await guardHostApi(request, "db.read");
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const connection = connectionSecrets(Number(body.connectionId ?? 0));
  if (!connection) {
    return Response.json(
      { error: serverT("api.db.connectionOrPassword") },
      { status: 400 },
    );
  }

  // Tablo gözatma ve serbest sorgu aynı uçtan geçiyor: ikisi de aynı
  // korumalara tabi olmalı ve sorgu geçmişine düşmeli.
  const browsing = body.mode === "table";
  const sql = browsing ? "" : String(body.sql ?? "");

  if (!browsing) {
    const analysis = analyzeSql(sql);
    const writes = analysis.kind === "write" || analysis.kind === "schema";

    if (writes && !hasPermission(guard.session.user, "db.write")) {
      audit({
        userId: guard.session.user.id,
        username: guard.session.user.username,
        action: "db.query",
        targetType: "db_connection",
        targetId: String(connection.id),
        detail: `yetkisiz yazma denemesi: ${sql.slice(0, 200)}`,
        result: "denied",
      });
      return Response.json(
        { error: serverT("api.db.writeRequired") },
        { status: 403 },
      );
    }
  }

  const started = Date.now();
  const outcome = browsing
    ? await readTable(
        connection,
        String(body.schema ?? ""),
        String(body.table ?? ""),
        {
          limit: Number(body.limit ?? 100),
          offset: Number(body.offset ?? 0),
          orderBy: body.orderBy ? String(body.orderBy) : undefined,
          desc: Boolean(body.desc),
          filter: body.filter ? String(body.filter) : undefined,
        },
      )
    : await runQuery(connection, sql, { confirmed: Boolean(body.confirmed) });

  const label = browsing ? `[${serverT("api.db.browse")}] ${body.schema}.${body.table}` : sql;

  // Onay bekleyen bir ifade henüz çalışmadı; geçmişe yazmak yanıltıcı olurdu.
  if (!outcome.ok && outcome.needsConfirmation) {
    return Response.json(
      { error: outcome.error, needsConfirmation: true, dangers: outcome.dangers },
      { status: 409 },
    );
  }

  recordQuery({
    connectionId: connection.id,
    userId: guard.session.user.id,
    username: guard.session.user.username,
    sql: label,
    durationMs: Date.now() - started,
    rowCount: outcome.ok ? outcome.result.rowCount : 0,
    ok: outcome.ok,
    error: outcome.ok ? "" : outcome.error,
  });

  // Veri değiştiren ve şema değiştiren her sorgu audit'e (PLAN M3.6).
  if (!browsing) {
    const analysis = analyzeSql(sql);
    if (analysis.kind === "write" || analysis.kind === "schema") {
      audit({
        userId: guard.session.user.id,
        username: guard.session.user.username,
        action: "db.query.write",
        targetType: "db_connection",
        targetId: String(connection.id),
        detail: `${connection.name}: ${sql.slice(0, 500)}${
          outcome.ok ? ` → ${serverT("api.db.rows", { count: outcome.result.affected ?? 0 })}` : ` — ${outcome.error}`
        }`,
        result: outcome.ok ? "ok" : "error",
      });
    }
  }

  if (!outcome.ok) return Response.json({ error: outcome.error }, { status: 400 });

  return Response.json({
    ok: true,
    result: outcome.result,
    history: listHistory(guard.session.user.id),
  });
}
