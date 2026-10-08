import "server-only";

import { serverT } from "@/lib/i18n/runtime";
import type { ConnectionSecrets } from "../store";
import type { DbUser } from "../types";
import { execQuery, execRaw } from "./runner";

/**
 * Envanter sunucusunda yönetim: veritabanı ve kullanıcı oluşturma/silme,
 * parola, hazır yetki setleri.
 *
 * SQL kullanıcı girdisiyle BİRLEŞTİRİLİYOR (DDL'de parametre yok), bu yüzden
 * adlar katı bir beyaz listeden geçiyor ve yine de tırnaklanıyor; parolalar
 * metin olarak kaçırılıyor. SQL istemciye ortam değişkeniyle gidiyor —
 * parola komut satırında görünmüyor (bkz. runner).
 */

export class AdminError extends Error {}

const NAME = /^[A-Za-z0-9_][A-Za-z0-9_$-]{0,63}$/;
const USER = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,31}$/;
const MYSQL_HOST = /^[A-Za-z0-9.%_:-]{1,60}$/;

const MYSQL_SYSTEM = new Set(["information_schema", "performance_schema", "mysql", "sys"]);
const PG_SYSTEM = new Set(["postgres", "template0", "template1"]);
const MYSQL_SYSTEM_USERS = new Set(["root", "mysql.sys", "mysql.session", "mysql.infoschema", "mariadb.sys", "debian-sys-maint"]);

function checkName(name: string): string {
  if (!NAME.test(name)) throw new AdminError(serverT("dbadmin.admin.badName"));
  return name;
}

function checkUser(name: string): string {
  if (!USER.test(name)) throw new AdminError(serverT("dbadmin.admin.badUser"));
  return name;
}

function checkHost(host: string): string {
  const value = host || "%";
  if (!MYSQL_HOST.test(value)) throw new AdminError(serverT("dbadmin.admin.badHost"));
  return value;
}

function checkPassword(password: string): string {
  if (password.length < 8 || password.length > 200 || password.includes("\0")) {
    throw new AdminError(serverT("dbadmin.admin.badPassword"));
  }
  return password;
}

/** MySQL metin sabiti: varsayılan kipte ters bölü de kaçış karakteri. */
function myString(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
}

/** Postgres metin sabiti (standard_conforming_strings açık). */
function pgString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

const myIdent = (name: string) => `\`${name}\``;
const pgIdent = (name: string) => `"${name}"`;
const myAccount = (user: string, host: string) => `${myString(user)}@${myString(host)}`;

/** GRANT'ta `_` ve `%` joker; birebir ad için kaçırılır. */
const myGrantDb = (name: string) => myIdent(name.replaceAll("_", "\\_").replaceAll("%", "\\%"));

function supported(connection: ConnectionSecrets): "mysql" | "postgres" {
  if (connection.engine === "mysql" || connection.engine === "postgres") return connection.engine;
  throw new AdminError(serverT("dbadmin.admin.unsupported"));
}

async function run(connection: ConnectionSecrets, sql: string, database = ""): Promise<void> {
  await execRaw(connection, sql, { database }, "plain");
}

export type Owner = { user: string; password: string; host?: string };

export async function createDatabase(connection: ConnectionSecrets, name: string, owner?: Owner): Promise<void> {
  const engine = supported(connection);
  checkName(name);

  if (engine === "mysql") {
    const statements = [`CREATE DATABASE ${myIdent(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`];
    if (owner) {
      const account = myAccount(checkUser(owner.user), checkHost(owner.host ?? "%"));
      statements.push(
        `CREATE USER IF NOT EXISTS ${account} IDENTIFIED BY ${myString(checkPassword(owner.password))};`,
        `GRANT ALL PRIVILEGES ON ${myGrantDb(name)}.* TO ${account};`,
      );
    }
    await run(connection, statements.join("\n"));
    return;
  }

  // CREATE DATABASE işlem bloğunda çalışmıyor; psql her ifadeyi ayrı gönderiyor.
  const statements: string[] = [];
  if (owner) {
    statements.push(`CREATE ROLE ${pgIdent(checkUser(owner.user))} LOGIN PASSWORD ${pgString(checkPassword(owner.password))};`);
    statements.push(`CREATE DATABASE ${pgIdent(name)} OWNER ${pgIdent(owner.user)};`);
  } else {
    statements.push(`CREATE DATABASE ${pgIdent(name)};`);
  }
  await run(connection, statements.join("\n"), "postgres");
}

export async function dropDatabase(connection: ConnectionSecrets, name: string): Promise<void> {
  const engine = supported(connection);
  checkName(name);
  if ((engine === "mysql" ? MYSQL_SYSTEM : PG_SYSTEM).has(name)) {
    throw new AdminError(serverT("dbadmin.admin.systemDb"));
  }
  if (engine === "mysql") {
    await run(connection, `DROP DATABASE ${myIdent(name)};`);
  } else {
    await run(connection, `DROP DATABASE ${pgIdent(name)};`, "postgres");
  }
}

export async function listUsers(connection: ConnectionSecrets): Promise<DbUser[]> {
  const engine = supported(connection);

  if (engine === "mysql") {
    const raw = await execQuery(
      { ...connection, database: "" },
      "SELECT User, Host, Super_priv FROM mysql.user ORDER BY User, Host",
      false,
    );
    const users = raw.rows.map((row) => ({
      name: String(row[0]),
      host: String(row[1]),
      superuser: String(row[2]) === "Y",
      grants: [] as string[],
    }));
    // Hesap başına SHOW GRANTS; tek istekte (çoklu ifade) okunur.
    const visible = users.filter((user) => !MYSQL_SYSTEM_USERS.has(user.name) || user.name === "root");
    if (visible.length > 0) {
      const { stdout } = await execRaw(
        { ...connection, database: "" },
        visible.map((user) => `SHOW GRANTS FOR ${myAccount(user.name, user.host)};`).join("\n"),
        {},
        "plain",
      );
      // stdin terminal değil → istemci yine batch biçiminde yazıyor: her
      // sonuç "Grants for …" başlığı + satır başına bir GRANT, ters bölüler kaçırılmış.
      const lines = stdout
        .split("\n")
        .filter((line) => line.startsWith("GRANT "))
        .map((line) => line.replaceAll("\\\\", "\\"));
      for (const user of visible) {
        const prefix = `TO ${myAccount(user.name, user.host)}`.replaceAll("'", "");
        user.grants = lines.filter((line) => {
          const plain = line.replaceAll("'", "").replaceAll("`", "");
          return plain.includes(prefix.replaceAll("`", ""));
        });
      }
    }
    return users;
  }

  const raw = await execQuery(
    { ...connection, database: "" },
    `SELECT r.rolname, r.rolsuper,
            COALESCE((SELECT string_agg(d.datname || ':owner', ',') FROM pg_database d WHERE d.datdba = r.oid), '') AS owned,
            COALESCE((SELECT string_agg(d.datname || ':connect', ',') FROM pg_database d
                      WHERE NOT d.datistemplate AND d.datdba <> r.oid
                        AND has_database_privilege(r.oid, d.oid, 'CONNECT')
                        AND d.datacl::text LIKE '%' || r.rolname || '=%'), '') AS granted
     FROM pg_roles r
     WHERE r.rolname !~ '^pg_' AND r.rolcanlogin
     ORDER BY r.rolname`,
    false,
  );
  return raw.rows.map((row) => ({
    name: String(row[0]),
    host: "",
    superuser: String(row[1]) === "t",
    grants: [String(row[2] ?? ""), String(row[3] ?? "")].join(",").split(",").filter((entry) => entry.length > 0),
  }));
}

export async function createUser(connection: ConnectionSecrets, user: string, password: string, host = "%"): Promise<void> {
  const engine = supported(connection);
  checkUser(user);
  checkPassword(password);
  if (engine === "mysql") {
    await run(connection, `CREATE USER ${myAccount(user, checkHost(host))} IDENTIFIED BY ${myString(password)};`);
  } else {
    await run(connection, `CREATE ROLE ${pgIdent(user)} LOGIN PASSWORD ${pgString(password)};`, "postgres");
  }
}

export async function dropUser(connection: ConnectionSecrets, user: string, host = "%"): Promise<void> {
  const engine = supported(connection);
  checkUser(user);
  if (user === "root" || user === "postgres" || MYSQL_SYSTEM_USERS.has(user)) {
    throw new AdminError(serverT("dbadmin.admin.systemUser"));
  }
  if (engine === "mysql") {
    await run(connection, `DROP USER ${myAccount(user, checkHost(host))};`);
  } else {
    await run(connection, `DROP ROLE ${pgIdent(user)};`, "postgres");
  }
}

export async function setPassword(connection: ConnectionSecrets, user: string, password: string, host = "%"): Promise<void> {
  const engine = supported(connection);
  checkUser(user);
  checkPassword(password);
  if (engine === "mysql") {
    await run(connection, `ALTER USER ${myAccount(user, checkHost(host))} IDENTIFIED BY ${myString(password)};`);
  } else {
    await run(connection, `ALTER ROLE ${pgIdent(user)} PASSWORD ${pgString(password)};`, "postgres");
  }
}

export type GrantLevel = "all" | "read";

export async function grant(
  connection: ConnectionSecrets,
  user: string,
  database: string,
  level: GrantLevel,
  host = "%",
): Promise<void> {
  const engine = supported(connection);
  checkUser(user);
  checkName(database);

  if (engine === "mysql") {
    const privileges = level === "all" ? "ALL PRIVILEGES" : "SELECT, SHOW VIEW";
    await run(connection, `GRANT ${privileges} ON ${myGrantDb(database)}.* TO ${myAccount(user, checkHost(host))};`);
    return;
  }

  // Postgres'te veritabanı yetkisi tablolara inmiyor; public şeması ve
  // gelecekte oluşacak tablolar için varsayılan yetki de veriliyor. Komutlar
  // hedef veritabanında çalışmalı.
  const role = pgIdent(user);
  const statements =
    level === "all"
      ? [
          `GRANT ALL PRIVILEGES ON DATABASE ${pgIdent(database)} TO ${role};`,
          `GRANT ALL ON SCHEMA public TO ${role};`,
          `GRANT ALL ON ALL TABLES IN SCHEMA public TO ${role};`,
          `GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ${role};`,
          `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${role};`,
          `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${role};`,
        ]
      : [
          `GRANT CONNECT ON DATABASE ${pgIdent(database)} TO ${role};`,
          `GRANT USAGE ON SCHEMA public TO ${role};`,
          `GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${role};`,
          `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${role};`,
        ];
  await run(connection, statements.join("\n"), database);
}

export async function revoke(connection: ConnectionSecrets, user: string, database: string, host = "%"): Promise<void> {
  const engine = supported(connection);
  checkUser(user);
  checkName(database);

  if (engine === "mysql") {
    await run(connection, `REVOKE ALL PRIVILEGES ON ${myGrantDb(database)}.* FROM ${myAccount(user, checkHost(host))};`);
    return;
  }
  const role = pgIdent(user);
  await run(
    connection,
    [
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM ${role};`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM ${role};`,
      `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role};`,
      `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${role};`,
      `REVOKE ALL ON SCHEMA public FROM ${role};`,
      `REVOKE ALL ON DATABASE ${pgIdent(database)} FROM ${role};`,
    ].join("\n"),
    database,
  );
}
