import { serverT } from "@/lib/i18n/runtime";
import { enterHost, guardHostApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { listTables, tableStructure, testConnection } from "@/lib/dbadmin";
import { buildInventory } from "@/lib/dbadmin/exec/inventory";
import {
  connectionSecrets,
  createConnection,
  deleteConnection,
  deleteSavedQuery,
  listConnections,
  listHistory,
  listSavedQueries,
  markConnection,
  saveQuery,
  setInstanceCredentials,
  setWritable,
  updateConnection,
  validateConnection,
  type ConnectionInput,
} from "@/lib/dbadmin/store";

export const dynamic = "force-dynamic";

function parseInput(body: Record<string, unknown>): ConnectionInput {
  return {
    name: String(body.name ?? ""),
    engine: String(body.engine ?? "sqlite"),
    host: String(body.host ?? ""),
    port: Number(body.port ?? 0),
    username: String(body.username ?? ""),
    password: String(body.password ?? ""),
    database: String(body.database ?? ""),
    writable: Boolean(body.writable),
  };
}

export async function GET(request: Request) {
  const guard = await guardHostApi(request, "db.read", { agent: true });
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");
  const id = Number(url.searchParams.get("id") ?? 0);

  if (mode === "inventory") {
    return Response.json(await buildInventory());
  }

  if (mode === "tables" || mode === "structure") {
    const found = connectionSecrets(id);
    // Envanterde seçilen veritabanı bağlantınınkinin yerine geçer.
    const database = url.searchParams.get("database");
    const connection = found && database !== null ? { ...found, database } : found;
    if (!connection) {
      return Response.json(
        { error: serverT("api.db.connectionOrPasswordMaster") },
        { status: 400 },
      );
    }

    try {
      if (mode === "tables") {
        return Response.json({ tables: await listTables(connection) });
      }
      return Response.json({
        structure: await tableStructure(
          connection,
          url.searchParams.get("schema") ?? "",
          url.searchParams.get("table") ?? "",
        ),
      });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : serverT("api.unreadable") },
        { status: 400 },
      );
    }
  }

  return Response.json({
    connections: listConnections(),
    history: listHistory(guard.session.user.id),
    saved: listSavedQueries(),
  });
}

export async function POST(request: Request) {
  // Bağlantı tanımlamak yazma yetkisi değil ama yapılandırma değişikliği;
  // `db.read` yeterli sayılmıyor.
  const guard = await guardHostApi(request, "db.write", { agent: true });
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const action = String(body.action ?? "create");

  if (action === "test") {
    const connection = connectionSecrets(Number(body.id ?? 0));
    if (!connection) return Response.json({ error: serverT("api.notFound.connection") }, { status: 404 });

    const outcome = await testConnection(connection);
    markConnection(connection.id, outcome.ok, outcome.ok ? "" : outcome.message);

    audit({
      userId: guard.session.user.id,
      username: guard.session.user.username,
      action: "db.test",
      targetType: "db_connection",
      targetId: String(connection.id),
      detail: outcome.message,
      result: outcome.ok ? "ok" : "error",
    });

    return Response.json({ ...outcome, connections: listConnections() });
  }

  if (action === "credentials") {
    // Envanter sunucusunun kimliği; boş kullanıcı "kendiliğinden bul"a döner.
    const id = Number(body.id ?? 0);
    if (!setInstanceCredentials(id, String(body.username ?? ""), String(body.password ?? ""))) {
      return Response.json({ error: serverT("api.notFound.connection") }, { status: 404 });
    }
    audit({
      userId: guard.session.user.id,
      username: guard.session.user.username,
      action: "db.connection.credentials",
      targetType: "db_connection",
      targetId: String(id),
      detail: String(body.username ?? "") || "auto",
      result: "ok",
    });
    return Response.json({ ok: true, connections: listConnections() });
  }

  if (action === "writable") {
    const id = Number(body.id ?? 0);
    const writable = Boolean(body.writable);
    if (!setWritable(id, writable)) {
      return Response.json({ error: serverT("api.notFound.connection") }, { status: 404 });
    }
    audit({
      userId: guard.session.user.id,
      username: guard.session.user.username,
      action: "db.connection.update",
      targetType: "db_connection",
      targetId: String(id),
      detail: writable ? serverT("api.db.writable") : serverT("api.db.readOnly"),
      result: "ok",
    });
    return Response.json({ ok: true, connections: listConnections() });
  }

  if (action === "save-query") {
    const id = saveQuery({
      connectionId: body.connectionId === null ? null : Number(body.connectionId ?? 0),
      name: String(body.name ?? ""),
      sql: String(body.sql ?? ""),
      username: guard.session.user.username,
    });
    return Response.json({ ok: true, id, saved: listSavedQueries() });
  }

  if (action === "delete-query") {
    deleteSavedQuery(Number(body.id ?? 0));
    return Response.json({ ok: true, saved: listSavedQueries() });
  }

  const input = parseInput(body);
  const problem = validateConnection(input);
  if (problem) return Response.json({ error: problem }, { status: 400 });

  const id = createConnection(input);

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "db.connection.create",
    targetType: "db_connection",
    targetId: String(id),
    detail: `${input.name} (${input.engine}) · ${input.writable ? serverT("api.db.writable") : serverT("api.db.readOnly")}`,
    result: "ok",
  });

  return Response.json({ ok: true, connections: listConnections() });
}

export async function PATCH(request: Request) {
  const guard = await guardHostApi(request, "db.write", { agent: true });
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
  const problem = validateConnection(input, id);
  if (problem) return Response.json({ error: problem }, { status: 400 });

  if (!updateConnection(id, input)) {
    return Response.json({ error: serverT("api.notFound.connection") }, { status: 404 });
  }

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "db.connection.update",
    targetType: "db_connection",
    targetId: String(id),
    // Yazma yetkisinin açılması özellikle kayda değer.
    detail: `${input.name} · ${input.writable ? serverT("api.db.writable") : serverT("api.db.readOnly")}`,
    result: "ok",
  });

  return Response.json({ ok: true, connections: listConnections() });
}

export async function DELETE(request: Request) {
  const guard = await guardHostApi(request, "db.write", { agent: true });
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  const id = Number(new URL(request.url).searchParams.get("id") ?? 0);
  if (!deleteConnection(id)) {
    return Response.json({ error: serverT("api.notFound.connection") }, { status: 404 });
  }

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "db.connection.delete",
    targetType: "db_connection",
    targetId: String(id),
    result: "ok",
  });

  return Response.json({ ok: true, connections: listConnections() });
}
