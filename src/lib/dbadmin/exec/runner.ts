import "server-only";

import path from "node:path";
import { credentialsFromEnv } from "@/lib/backup/discover";
import { currentHostId } from "@/lib/hosts/context";
import { panelImage } from "@/lib/host/self";
import { serverT } from "@/lib/i18n/runtime";
import { getDockerProvider } from "@/lib/providers";
import type { ExecResult, ThrowawaySpec } from "@/lib/providers/types";
import { getNumber } from "@/lib/settings";
import type { Raw } from "../drivers/network";
import type { ConnectionSecrets } from "../store";
import { parseCsv, parseMysqlBatch, parsePgTag } from "./parse";

/**
 * Envanterdeki sunuculara erişim: sürücü yerine istemci CLI'ı DB'nin YANINDA
 * çalıştırılır.
 *
 * - docker: DB container'ının içinde `docker exec` — container'ın kendi
 *   `mysql`/`psql`/`redis-cli`'ı, kendi soketi. Panelin DB ile aynı Docker
 *   ağında olması gerekmiyor (eskiden ENOTFOUND buradan geliyordu).
 * - native: panel imajından geçici container; host'taki soket dizini
 *   bağlanır. MySQL root'u `unix_socket` ile (container root = host root),
 *   Postgres `peer` ile (container host'taki postgres uid'iyle) girer.
 *
 * SQL komut satırında değil `PANEL_SQL` ortam değişkeninde gider ve stdin'e
 * yazılır: parola içeren yönetim komutları `ps` çıktısında görünmesin, uzun
 * sorgular argv sınırına takılmasın.
 *
 * Bu modül merkezde çalışır; `getDockerProvider()` ve `panelImage()` seçili
 * sunucuya göre yönlendirdiği için uzak sunucuda da aynı kod geçerli.
 */

type Invocation = {
  script: string;
  args: string[];
  env: Record<string, string>;
  binds: string[];
  user?: string;
};

export type ExecOptions = {
  /** Bağlanılacak veritabanı; verilmezse bağlantınınki. */
  database?: string;
  timeoutMs?: number;
};

const NO_ENV = "__PANEL_NOENV__";

function clientScript(finder: string): string {
  return [
    `C=$(${finder}) || { echo "client not found" >&2; exit 127; }`,
    `[ -n "$PANEL_SQL" ] || { echo ${NO_ENV} >&2; exit 97; }`,
    `printf '%s\\n' "$PANEL_SQL" | "$C" "$@"`,
  ].join("\n");
}

const MYSQL_SCRIPT = clientScript("command -v mariadb || command -v mysql");
const PSQL_SCRIPT = clientScript("command -v psql");
const REDIS_SCRIPT = clientScript("command -v redis-cli || command -v valkey-cli");

function defaultTimeout(): number {
  return getNumber("dbadmin.timeout_seconds") * 1000 + 10_000;
}

/* --- Kimlik --- */

type ContainerInfo = { env: Record<string, string>; image: string; running: boolean };
const containerCache = new Map<string, { info: ContainerInfo; at: number }>();

async function containerInfo(container: string): Promise<ContainerInfo> {
  const cacheKey = `${currentHostId()}:${container}`;
  const cached = containerCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 30_000) return cached.info;

  const raw = (await getDockerProvider().inspectRaw(container)) as {
    Config?: { Image?: string; Env?: string[] };
    State?: { Status?: string };
  } | null;
  if (!raw) throw new Error(serverT("backupEngine.containerMissing", { name: container }));

  const env: Record<string, string> = {};
  for (const entry of raw.Config?.Env ?? []) {
    const index = entry.indexOf("=");
    if (index > 0) env[entry.slice(0, index)] = entry.slice(index + 1);
  }
  const info = { env, image: raw.Config?.Image ?? "", running: raw.State?.Status === "running" };
  containerCache.set(cacheKey, { info, at: Date.now() });
  return info;
}

export type DockerCredentials = { user: string; password: string; port: number; source: "manual" | "env" | "none" };

/** Container'ın kimliği: önce kullanıcının girdiği, sonra env (root tercihli). */
export async function dockerCredentials(connection: ConnectionSecrets): Promise<DockerCredentials> {
  const { env } = await containerInfo(connection.container);
  const manual = connection.username.length > 0;

  if (connection.engine === "postgres") {
    const port = Number(env.PGPORT ?? 5432);
    if (manual) return { user: connection.username, password: connection.password, port, source: "manual" };
    // Resmi imajda yerel soket `trust`; parola yine de verilir.
    return {
      user: env.POSTGRES_USER ?? env.PGUSER ?? "postgres",
      password: env.POSTGRES_PASSWORD ?? env.PGPASSWORD ?? "",
      port,
      source: "env",
    };
  }

  if (connection.engine === "redis") {
    const password = manual || connection.password ? connection.password : (env.REDIS_PASSWORD ?? "");
    return { user: "", password, port: 6379, source: connection.password ? "manual" : "env" };
  }

  const port = Number(env.MYSQL_TCP_PORT ?? 3306);
  if (manual) return { user: connection.username, password: connection.password, port, source: "manual" };
  const fromEnv = credentialsFromEnv("mysql", env);
  if (fromEnv) return { user: fromEnv.user, password: fromEnv.password, port, source: "env" };
  return { user: "root", password: "", port, source: "none" };
}

/* --- Çağrı kurulumu --- */

/**
 * Bir sunucuya NASIL bağlanılacağı: yalnız bağlantı seçenekleri (adres,
 * kullanıcı, soket). İstemci (`psql`, `mysql`) ve döküm aracı (`pg_dump`,
 * `mariadb-dump`) bunun üstüne kendi seçeneklerini ekler.
 */
type Target = {
  connect: string[];
  env: Record<string, string>;
  binds: string[];
  user?: string;
};

type MysqlMode = "manual" | "socket" | "debian";
const mysqlModes = new Map<string, MysqlMode>();

async function dockerTarget(connection: ConnectionSecrets): Promise<Target> {
  const credentials = await dockerCredentials(connection);

  if (connection.engine === "postgres") {
    return {
      connect: ["-p", String(credentials.port), "-U", credentials.user],
      env: credentials.password ? { PGPASSWORD: credentials.password } : {},
      binds: [],
    };
  }
  if (connection.engine === "redis") {
    return {
      connect: [],
      env: credentials.password ? { REDISCLI_AUTH: credentials.password } : {},
      binds: [],
    };
  }
  return {
    connect: ["-u", credentials.user],
    env: credentials.password ? { MYSQL_PWD: credentials.password } : {},
    binds: [],
  };
}

function nativeTarget(connection: ConnectionSecrets, mode: MysqlMode): Target {
  const meta = connection.meta;
  if (meta.stopped) throw new Error(serverT("dbadmin.native.stopped", { service: meta.service ?? "" }));
  const manual = connection.username.length > 0;
  const env: Record<string, string> = { HOME: "/tmp" };

  if (connection.engine === "postgres") {
    if (manual) {
      // Girilen kullanıcı peer ile eşleşmez; host ağından TCP + parola.
      if (connection.password) env.PGPASSWORD = connection.password;
      return {
        connect: ["-h", "127.0.0.1", "-p", String(connection.port), "-U", connection.username],
        env,
        binds: [],
        user: "0:0",
      };
    }
    if (meta.uid === undefined || !meta.socket) throw new Error(serverT("dbadmin.native.noPostgresUser"));
    return {
      connect: ["-h", meta.socket, "-p", String(connection.port), "-U", "postgres"],
      env,
      binds: [`${meta.socket}:${meta.socket}`],
      user: `${meta.uid}:${meta.gid ?? meta.uid}`,
    };
  }

  if (connection.engine === "redis") {
    if (connection.password) env.REDISCLI_AUTH = connection.password;
    if (!meta.socket) {
      return { connect: ["-h", "127.0.0.1", "-p", String(connection.port)], env, binds: [], user: "0:0" };
    }
    const directory = path.posix.dirname(meta.socket);
    return { connect: ["-s", meta.socket], env, binds: [`${directory}:${directory}`], user: "0:0" };
  }

  const socket = meta.socket ?? "/run/mysqld/mysqld.sock";
  const directory = path.posix.dirname(socket);
  const binds = [`${directory}:${directory}`];

  if (mode === "manual") {
    if (connection.password) env.MYSQL_PWD = connection.password;
    return { connect: ["-u", connection.username, "--socket", socket], env, binds, user: "0:0" };
  }
  if (mode === "debian") {
    // --defaults-file ilk seçenek olmak zorunda.
    return {
      connect: ["--defaults-file=/etc/mysql/debian.cnf", "--socket", socket],
      env,
      binds: [...binds, "/etc/mysql/debian.cnf:/etc/mysql/debian.cnf:ro"],
      user: "0:0",
    };
  }
  return { connect: ["-u", "root", "--socket", socket], env, binds, user: "0:0" };
}

function redisDb(database: string): string[] {
  const match = database.match(/^(?:db)?(\d+)$/);
  return match ? ["-n", match[1]] : [];
}

/** İstemci komutu: bağlantı + veritabanı + çıktı biçimi. */
function clientInvocation(
  connection: ConnectionSecrets,
  target: Target,
  database: string,
  format: "table" | "plain",
): Invocation {
  const base = { env: target.env, binds: target.binds, user: target.user };
  if (connection.engine === "postgres") {
    return {
      ...base,
      script: PSQL_SCRIPT,
      args: [
        ...target.connect,
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        database || "postgres",
        ...(format === "table" ? ["--csv"] : []),
      ],
    };
  }
  if (connection.engine === "redis") {
    return { ...base, script: REDIS_SCRIPT, args: ["--no-auth-warning", ...target.connect, ...redisDb(database)] };
  }
  return {
    ...base,
    script: MYSQL_SCRIPT,
    args: [
      ...target.connect,
      "--default-character-set=utf8mb4",
      ...(format === "table" ? ["--batch"] : []),
      ...(database ? ["-D", database] : []),
    ],
  };
}

/* --- Çalıştırma --- */

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function cleanError(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/^psql:<stdin>:\d+: /, "").trim())
    .filter((line) => line.length > 0 && !line.includes(NO_ENV))
    .join("\n")
    .slice(0, 600);
}

async function execute(
  connection: ConnectionSecrets,
  invocation: Invocation,
  sql: string,
  options: ExecOptions,
): Promise<{ stdout: string; stderr: string }> {
  const timeoutMs = options.timeoutMs ?? defaultTimeout();
  const env = { ...invocation.env, PANEL_SQL: sql };
  let result: ExecResult;

  if (connection.transport === "docker") {
    const info = await containerInfo(connection.container);
    if (!info.running) throw new Error(serverT("backupEngine.dbNotRunning", { name: connection.container }));
    result = await getDockerProvider().runOnce(
      connection.container,
      ["sh", "-c", invocation.script, "sh", ...invocation.args],
      { env: Object.entries(env).map(([key, value]) => `${key}=${value}`), timeoutMs },
    );
  } else {
    const image = await panelImage();
    if (!image) throw new Error(serverT("dbadmin.native.noImage"));
    const spec: ThrowawaySpec = {
      image,
      entrypoint: ["sh", "-c", invocation.script, "sh"],
      cmd: invocation.args,
      binds: invocation.binds,
      env,
      namePrefix: "panel-db",
      timeoutMs,
      user: invocation.user,
      networkMode: "host",
    };
    result = await getDockerProvider().runThrowaway(spec);
  }

  // Eski ajan: runOnce seçenekleri (ortam) yok sayılıyor ve stdout ayrı gelmiyor.
  if (result.stdout === undefined || result.exitCode === 97 || (result.stderr ?? "").includes(NO_ENV)) {
    throw new Error(serverT("dbadmin.agentOutdated"));
  }
  // Native erişim panel imajındaki istemcileri kullanıyor; eski imajda yoklar.
  if (result.exitCode === 127 && connection.transport === "native") {
    throw new Error(serverT("dbadmin.agentOutdated"));
  }
  if (result.exitCode !== 0) {
    throw new Error(cleanError(result.stderr || result.output) || serverT("dbadmin.execFailed", { code: result.exitCode }));
  }
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

const ACCESS_DENIED = /access denied|ERROR 1698|ERROR 1045/i;

/** SQL'i (ya da Redis komutlarını) çalıştırır; ham metni döndürür. */
export async function execRaw(
  connection: ConnectionSecrets,
  sql: string,
  options: ExecOptions = {},
  format: "table" | "plain" = "table",
): Promise<{ stdout: string; stderr: string }> {
  const database = options.database ?? connection.database;
  const run = (target: Target) =>
    execute(connection, clientInvocation(connection, target, database, format), sql, options);

  if (connection.transport === "docker") return run(await dockerTarget(connection));
  if (connection.engine !== "mysql") return run(nativeTarget(connection, "socket"));

  // Native MySQL: kullanıcı kimlik girdiyse o; yoksa root soketi, o da
  // reddedilirse (eski Debian kurulumları) debian.cnf bakım hesabı.
  if (connection.username) return run(nativeTarget(connection, "manual"));

  const cacheKey = `${currentHostId()}:${connection.instanceKey}`;
  const remembered = mysqlModes.get(cacheKey);
  const modes: MysqlMode[] = remembered ? [remembered] : connection.meta.debianCnf ? ["socket", "debian"] : ["socket"];

  let lastError: unknown = null;
  for (const mode of modes) {
    try {
      const output = await run(nativeTarget(connection, mode));
      mysqlModes.set(cacheKey, mode);
      return output;
    } catch (error) {
      lastError = error;
      if (!(error instanceof Error) || !ACCESS_DENIED.test(error.message)) throw error;
    }
  }
  mysqlModes.delete(cacheKey);
  throw lastError;
}

/** Tek ifadeyi çalıştırıp sürücü biçiminde (`Raw`) döndürür. */
export async function execQuery(
  connection: ConnectionSecrets,
  sql: string,
  writes: boolean,
  options: ExecOptions = {},
): Promise<Raw> {
  if (connection.engine === "redis") {
    const { stdout } = await execRaw(connection, sql, options);
    const lines = stdout.replace(/\n$/, "").split("\n");
    return {
      columns: [serverT("dbDriver.value")],
      rows: stdout.length === 0 ? [] : lines.map((line) => [line]),
      affected: null,
    };
  }

  if (connection.engine === "postgres") {
    const { stdout } = await execRaw(connection, sql, options);
    const tag = writes ? parsePgTag(stdout) : null;
    if (tag) return { columns: [], rows: [], affected: tag.affected ?? 0 };
    const parsed = parseCsv(stdout);
    return { columns: parsed.columns, rows: parsed.rows, affected: null };
  }

  if (writes) {
    // `mysql --batch` yazma sonrası bir şey yazmıyor; etkilenen satır ayrıca okunur.
    const statement = sql.trim().replace(/;+\s*$/, "");
    const { stdout } = await execRaw(connection, `${statement};\nSELECT ROW_COUNT() AS affected;`, options);
    const parsed = parseMysqlBatch(stdout);
    if (parsed.columns.length === 1 && parsed.columns[0] === "affected") {
      return { columns: [], rows: [], affected: Math.max(0, Number(parsed.rows[0]?.[0] ?? 0)) };
    }
    return { columns: parsed.columns, rows: parsed.rows, affected: null };
  }

  const { stdout } = await execRaw(connection, sql, options);
  const parsed = parseMysqlBatch(stdout);
  return { columns: parsed.columns, rows: parsed.rows, affected: null };
}

/* --- Döküm --- */

export type DumpPlan = { spec: ThrowawaySpec; marker: string };

/**
 * Tek veritabanının dökümü için geçici container.
 *
 * Çıktı container içinde gzip'lenip base64 satırlarına çevrilir: Docker log
 * akışı çerçeveleri UTF-8 karakter ortasından bölebiliyor ve boş satırları
 * atıyor; base64 ASCII ve satır başına bağımsız çözülebiliyor. Hata, kabuk
 * pipefail'siz olduğu için işaret satırıyla stderr'e bildiriliyor.
 */
export async function dumpPlan(connection: ConnectionSecrets, database: string): Promise<DumpPlan> {
  const marker = "__PANEL_DUMP_FAILED__";
  const timeoutMs = 6 * 60 * 60_000;

  const wrap = (command: string) =>
    `{ ${command} || echo "${marker} $?" >&2; } | gzip -c | base64`;

  if (connection.engine === "redis") throw new Error(serverT("dbadmin.dumpUnsupported"));

  if (connection.transport === "docker") {
    const info = await containerInfo(connection.container);
    if (!info.running) throw new Error(serverT("backupEngine.dbNotRunning", { name: connection.container }));
    const credentials = await dockerCredentials(connection);
    const env: Record<string, string> = {};
    let command: string;
    if (connection.engine === "postgres") {
      if (credentials.password) env.PGPASSWORD = credentials.password;
      command = `pg_dump -h 127.0.0.1 -p ${credentials.port} -U "$DB_USER" --clean --if-exists --create -d "$DB_NAME"`;
    } else {
      if (credentials.password) env.MYSQL_PWD = credentials.password;
      command =
        'D=$(command -v mariadb-dump || command -v mysqldump) || exit 127; ' +
        `"$D" -h 127.0.0.1 -P ${credentials.port} -u "$DB_USER" --single-transaction --routines --events --triggers --hex-blob --databases "$DB_NAME"`;
    }
    return {
      marker,
      spec: {
        image: info.image,
        entrypoint: ["sh", "-c", wrap(command)],
        cmd: [],
        binds: [],
        env: { ...env, DB_USER: credentials.user, DB_NAME: database },
        // DB container'ının ağ ad alanı: 127.0.0.1 doğrudan veritabanı.
        networkMode: `container:${connection.container}`,
        namePrefix: "panel-db-dump",
        timeoutMs,
      },
    };
  }

  const image = await panelImage();
  if (!image) throw new Error(serverT("dbadmin.native.noImage"));
  const mode: MysqlMode = connection.username
    ? "manual"
    : (mysqlModes.get(`${currentHostId()}:${connection.instanceKey}`) ?? "socket");
  const target = nativeTarget(connection, mode);
  const connect = target.connect.map(shellQuote).join(" ");
  const command =
    connection.engine === "postgres"
      ? `pg_dump ${connect} --clean --if-exists --create -d "$DB_NAME"`
      : `mariadb-dump ${connect} --single-transaction --routines --events --triggers --hex-blob --databases "$DB_NAME"`;
  return {
    marker,
    spec: {
      image,
      entrypoint: ["sh", "-c", wrap(command)],
      cmd: [],
      binds: target.binds,
      env: { ...target.env, DB_NAME: database },
      user: target.user,
      networkMode: "host",
      namePrefix: "panel-db-dump",
      timeoutMs,
    },
  };
}
