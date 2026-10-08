import { serverT } from "@/lib/i18n/runtime";
import { enterHost, guardHostApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import {
  AdminError,
  createDatabase,
  createUser,
  dropDatabase,
  dropUser,
  grant,
  listUsers,
  revoke,
  setPassword,
  type GrantLevel,
} from "@/lib/dbadmin/exec/admin";
import { connectionSecrets } from "@/lib/dbadmin/store";

export const dynamic = "force-dynamic";

/**
 * Envanter sunucusunda yönetim (veritabanı/kullanıcı/yetki).
 *
 * Yalnız envanterden gelen (docker/native) sunucularda: orada panel
 * yönetici hesabıyla (root/postgres) giriyor. Elle eklenen bağlantının
 * kullanıcısı genelde sınırlı ve bu işlemler için uygun değil.
 *
 * `db.write` yeterli ama bağlantının "yazılabilir" bayrağı ARANMIYOR: bayrak
 * SQL editörünü korur; buradaki her işlem ayrı bir düğme ve onayla geliyor.
 * Parolalar audit kaydına yazılmaz.
 */
export async function POST(request: Request) {
  const guard = await guardHostApi(request, "db.write", { agent: true });
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
    return Response.json({ error: serverT("api.db.connectionOrPasswordMaster") }, { status: 400 });
  }
  if (connection.transport === "tcp" || connection.engine === "sqlite") {
    return Response.json({ error: serverT("dbadmin.admin.inventoryOnly") }, { status: 400 });
  }

  const action = String(body.action ?? "");
  const text = (key: string) => String(body[key] ?? "").trim();
  const user = text("user");
  const host = text("host") || "%";
  const database = text("database");
  const password = String(body.password ?? "");

  const record = (detail: string, ok: boolean) =>
    audit({
      userId: guard.session.user.id,
      username: guard.session.user.username,
      action: `db.admin.${action}`,
      targetType: "db_connection",
      targetId: String(connection.id),
      detail: `${connection.container || connection.meta.service || connection.engine}: ${detail}`,
      result: ok ? "ok" : "error",
    });

  try {
    switch (action) {
      case "users":
        return Response.json({ users: await listUsers(connection) });

      case "create-db": {
        const owner = user ? { user, password, host } : undefined;
        await createDatabase(connection, database, owner);
        record(owner ? `${database} (+ ${user})` : database, true);
        break;
      }
      case "drop-db":
        // İstemci adı yeniden yazdırıyor; sunucu da eşleşmeyi istiyor.
        if (text("confirm") !== database) {
          return Response.json({ error: serverT("dbadmin.admin.confirmMismatch") }, { status: 400 });
        }
        await dropDatabase(connection, database);
        record(database, true);
        break;
      case "create-user":
        await createUser(connection, user, password, host);
        record(user, true);
        break;
      case "drop-user":
        await dropUser(connection, user, host);
        record(user, true);
        break;
      case "set-password":
        await setPassword(connection, user, password, host);
        record(user, true);
        break;
      case "grant": {
        const level: GrantLevel = body.level === "read" ? "read" : "all";
        await grant(connection, user, database, level, host);
        record(`${user} → ${database} (${level})`, true);
        break;
      }
      case "revoke":
        await revoke(connection, user, database, host);
        record(`${user} ✕ ${database}`, true);
        break;
      default:
        return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!(error instanceof AdminError)) record(message.slice(0, 200), false);
    return Response.json({ error: message }, { status: 400 });
  }

  return Response.json({ ok: true });
}
