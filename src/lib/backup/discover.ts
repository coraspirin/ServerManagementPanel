import "server-only";

import { listConnections } from "@/lib/dbadmin/store";
import { currentHostId, LOCAL_HOST_ID } from "@/lib/hosts/context";
import { panelContainerName } from "@/lib/host/self";
import { getDockerProvider } from "@/lib/providers";
import { shellRun } from "./runner";
import { getSystemJob } from "./store/jobs";
import type { DbEngineKind, DbItem, DockerItem, DockerMount, OsItem } from "./types";

/**
 * Otomatik bulma: kullanıcı yol ya da ad YAZMAZ; panel sunucudaki container'ları,
 * klasörleri ve veritabanlarını listeler, kullanıcı işaretler.
 */

/* --- Docker --- */

type RawContainer = {
  Name?: string;
  Config?: { Image?: string; Env?: string[]; Labels?: Record<string, string> };
  State?: { Status?: string };
  Mounts?: { Type?: string; Name?: string; Source?: string; Destination?: string }[];
};

/** Yedeğe asla girmeyecek bind kaynakları: sistem yolları ve soketler. */
export function isSystemBind(source: string): boolean {
  if (source === "/" || source.endsWith(".sock")) return true;
  return /^\/(proc|sys|dev|run|boot|var\/run|var\/lib\/docker|tmp)(\/|$)/.test(source);
}

const DB_PATTERNS: { engine: DbEngineKind; pattern: RegExp }[] = [
  { engine: "postgres", pattern: /postgres|timescale|pgvector|postgis/i },
  { engine: "mysql", pattern: /mysql|mariadb|percona/i },
];

export function dbEngineOf(image: string): DbEngineKind | null {
  return DB_PATTERNS.find((entry) => entry.pattern.test(image))?.engine ?? null;
}

/** SQLite benzeri dosya tabanlı veri işaretleri — "yedekte durdur" önerilir. */
const STOP_HINTS = /home-?assistant|vaultwarden|bitwarden|jellyfin|plex|uptime-kuma|sonarr|radarr|prowlarr|lidarr|bazarr|grafana|gitea|forgejo|paperless|immich|nextcloud|n8n|node-red|zigbee2mqtt/i;

export function toMounts(raw: RawContainer["Mounts"]): DockerMount[] {
  return (raw ?? [])
    .filter((mount) => mount.Type === "volume" || mount.Type === "bind")
    .map((mount) => {
      const type = mount.Type as "volume" | "bind";
      const source = type === "volume" ? String(mount.Name ?? "") : String(mount.Source ?? "");
      return {
        type,
        source,
        destination: String(mount.Destination ?? ""),
        skipped: source.length === 0 || (type === "bind" && isSystemBind(source)),
      };
    });
}

export async function inspectContainer(name: string): Promise<RawContainer | null> {
  try {
    return (await getDockerProvider().inspectRaw(name)) as RawContainer | null;
  } catch {
    return null;
  }
}

function isSelfContainer(name: string, mounts: DockerMount[]): boolean {
  return name === panelContainerName() || mounts.some((mount) => mount.destination === "/host/root");
}

export async function discoverDocker(): Promise<DockerItem[]> {
  const job = getSystemJob("docker");
  const sources = new Map((job?.sources ?? []).filter((s) => s.kind === "container").map((s) => [s.ref, s]));
  const containers = await getDockerProvider().list(true);

  const items = await Promise.all(
    containers.map(async (container): Promise<DockerItem> => {
      const raw = await inspectContainer(container.id);
      const mounts = toMounts(raw?.Mounts);
      const labels = raw?.Config?.Labels ?? container.labels ?? {};
      const isSelf = isSelfContainer(container.name, mounts);
      const isDatabase = dbEngineOf(container.image) !== null;
      const source = sources.get(container.name);
      // Kayıt yoksa: iş hiç kurulmadıysa önerilen (panel hariç hepsi), kurulduysa
      // "yeni container'ları otomatik dahil et" ayarı belirler.
      const selected = source
        ? source.enabled
        : job
          ? job.options.autoInclude && !isSelf
          : !isSelf;
      return {
        name: container.name,
        image: container.image,
        state: container.state,
        mounts,
        composeProject: labels["com.docker.compose.project"] ?? "",
        composeDir: labels["com.docker.compose.project.working_dir"] ?? "",
        isDatabase,
        isSelf,
        suggestStop: STOP_HINTS.test(container.image) || STOP_HINTS.test(container.name),
        selected,
        stop: source?.options.stop === true,
      };
    }),
  );
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

/* --- İşletim sistemi --- */

/** Önerilen set: yapılandırma + kişisel veriler + paket listesi. */
export const OS_RECOMMENDED = [
  "/etc",
  "/home",
  "/root",
  "/var/spool/cron",
  "/usr/local",
  "/opt",
  "/var/lib/dpkg/status",
  "/var/lib/apt/extended_states",
];

/** Host kökünün restic/yardımcı container'daki yeri. */
export const HOST_MOUNT = "/host";

/** Verilen host yollarından gerçekten var olanlar (tek container turu). */
export async function existingHostPaths(paths: string[]): Promise<Set<string>> {
  const safe = paths.filter((path) => /^\/[A-Za-z0-9._\-/]*$/.test(path) && !path.includes(".."));
  if (safe.length === 0) return new Set();
  const script = safe.map((path) => `[ -e '${HOST_MOUNT}${path}' ] && echo '${path}'`).join("; ") + "; true";
  const result = await shellRun(script, { binds: [`/:${HOST_MOUNT}:ro`], namePrefix: "panel-backup-probe" });
  // Betik `true` ile bitiyor; sıfırdan farklı çıkış = yoklama hiç çalışamadı.
  if (result.exitCode !== 0) throw new Error(result.output.trim().slice(0, 300) || "probe failed");
  return new Set(
    result.output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => safe.includes(line)),
  );
}

export async function discoverOs(): Promise<OsItem[]> {
  const job = getSystemJob("os");
  const saved = (job?.sources ?? []).filter((source) => source.kind === "host_dir");
  const paths = [...new Set([...OS_RECOMMENDED, ...saved.map((source) => source.ref)])];
  let existing: Set<string>;
  try {
    existing = await existingHostPaths(paths);
  } catch {
    existing = new Set(paths);
  }
  return paths
    .filter((path) => existing.has(path) || saved.some((source) => source.ref === path))
    .map((path) => {
      const source = saved.find((entry) => entry.ref === path);
      return {
        path,
        recommended: OS_RECOMMENDED.includes(path),
        selected: source ? source.enabled : job ? false : OS_RECOMMENDED.includes(path),
      };
    });
}

/* --- Veritabanı --- */

function envMap(env: string[] | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of env ?? []) {
    const index = entry.indexOf("=");
    if (index > 0) map[entry.slice(0, index)] = entry.slice(index + 1);
  }
  return map;
}

/** Container env'inden döküm kimliği; bulunamazsa null. */
export function credentialsFromEnv(
  engine: DbEngineKind,
  env: Record<string, string>,
): { user: string; password: string; database: string; all: boolean } | null {
  if (engine === "postgres") {
    const password = env.POSTGRES_PASSWORD ?? env.PGPASSWORD ?? "";
    const trust = env.POSTGRES_HOST_AUTH_METHOD === "trust";
    if (!password && !trust) return null;
    return { user: env.POSTGRES_USER ?? env.PGUSER ?? "postgres", password, database: "", all: true };
  }
  const rootPassword = env.MYSQL_ROOT_PASSWORD ?? env.MARIADB_ROOT_PASSWORD;
  const allowEmpty = ["yes", "1", "true"].includes(
    String(env.MYSQL_ALLOW_EMPTY_PASSWORD ?? env.MARIADB_ALLOW_EMPTY_ROOT_PASSWORD ?? "").toLowerCase(),
  );
  if (rootPassword || allowEmpty) return { user: "root", password: rootPassword ?? "", database: "", all: true };
  const user = env.MYSQL_USER ?? env.MARIADB_USER;
  const password = env.MYSQL_PASSWORD ?? env.MARIADB_PASSWORD;
  const database = env.MYSQL_DATABASE ?? env.MARIADB_DATABASE;
  if (user && password && database) return { user, password, database, all: false };
  return null;
}

export async function discoverDatabases(): Promise<DbItem[]> {
  const job = getSystemJob("database");
  const saved = new Map((job?.sources ?? []).map((source) => [`${source.kind}:${source.ref}`, source]));
  // Veritabanı envanterinin kimliksiz satırları (kullanıcı adı boş) yedeğe
  // kimlik sağlamaz.
  const connections = listConnections().filter(
    (connection) => connection.container.length > 0 && connection.username.length > 0,
  );
  const items: DbItem[] = [];

  const containers = await getDockerProvider().list(true);
  for (const container of containers) {
    const engine = dbEngineOf(container.image);
    if (!engine) continue;
    const raw = await inspectContainer(container.id);
    const env = envMap(raw?.Config?.Env);
    const credentials = credentialsFromEnv(engine, env)
      ? "env"
      : connections.some((connection) => connection.container === container.name)
        ? "connection"
        : "missing";
    const source = saved.get(`db:${container.name}`);
    items.push({
      ref: container.name,
      kind: "db",
      engine,
      image: container.image,
      state: container.state,
      credentials,
      selected: source ? source.enabled : job ? job.options.autoInclude : true,
    });
  }

  // Panelin kendi veritabanı yalnızca kendi sunucusunda.
  if (currentHostId() === LOCAL_HOST_ID) {
    const source = saved.get("panel_db:");
    items.unshift({
      ref: "",
      kind: "panel_db",
      engine: "sqlite",
      image: "",
      state: "running",
      credentials: "none",
      selected: source ? source.enabled : true,
    });
  }
  return items;
}
