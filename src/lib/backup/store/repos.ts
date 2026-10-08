import "server-only";

import { randomBytes } from "node:crypto";

import { getDb } from "@/lib/db/client";
import { currentHostId } from "@/lib/hosts/context";
import { decryptSecret, encryptSecret, type EncryptedValue } from "@/lib/crypto";
import { serverT } from "@/lib/i18n/runtime";
import { REPO_KINDS, type BackupRepo, type RepoKind, type RepoOptions, type RepoStats } from "../types";

/**
 * Yedek konumları (restic depoları).
 *
 * Çoklu sunucu: kayıtlar sunucuya bağlı (`host_id`); liste, ekleme ve kimlikle
 * erişim etkin sunucuyla (`currentHostId()`) sınırlı.
 *
 * Gizli alanlar (`env_enc`) satır başına `ANAHTAR=değer`, T3 ile şifreli.
 * SMB/NFS anahtarları restic'e GİTMEZ — Docker volume'ünü bağlamak içindir.
 */

/** Formda yeniden gösterilebilen, gizli olmayan alanlar. */
const PUBLIC_ENV = new Set(["SMB_USERNAME", "SMB_DOMAIN", "SMB_VERSION", "NFS_OPTIONS", "AWS_DEFAULT_REGION", "AWS_ACCESS_KEY_ID"]);

/** Yalnızca volume bağlamak için; restic container'ına aktarılmaz. */
export const MOUNT_ENV_PREFIXES = ["SMB_", "NFS_"];

const DEFAULT_OPTIONS: RepoOptions = { limitUploadKb: 0, limitDownloadKb: 0 };

function readEncrypted(raw: string): string | null {
  if (!raw) return null;
  try {
    return decryptSecret(JSON.parse(raw) as EncryptedValue);
  } catch {
    return null;
  }
}

function parseEnv(raw: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    env[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return env;
}

function serializeEnv(env: Record<string, string>): string {
  return Object.entries(env)
    .filter(([key, value]) => key.trim().length > 0 && value.length > 0)
    .map(([key, value]) => `${key.trim()}=${value}`)
    .join("\n");
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(raw) as T) };
  } catch {
    return fallback;
  }
}

function toRepo(row: Record<string, string | number | null>): BackupRepo {
  const enc = String(row.password_enc ?? "");
  const env = parseEnv(readEncrypted(String(row.env_enc ?? "")) ?? "");
  const stats = String(row.stats_json ?? "");
  return {
    id: Number(row.id),
    name: String(row.name),
    kind: String(row.kind) as RepoKind,
    location: String(row.location),
    envKeys: Object.keys(env),
    publicEnv: Object.fromEntries(Object.entries(env).filter(([key]) => PUBLIC_ENV.has(key))),
    hasPassword: enc.length > 0,
    passwordReadable: enc.length > 0 && readEncrypted(enc) !== null,
    initialized: Number(row.initialized) === 1,
    lastCheckAt: row.last_check_at === null ? null : Number(row.last_check_at),
    lastError: String(row.last_error ?? ""),
    jobCount: Number(row.job_count ?? 0),
    options: parseJson(row.options_json, DEFAULT_OPTIONS),
    stats: stats ? parseJson<RepoStats | null>(stats, null) : null,
    statsAt: row.stats_at === null ? null : Number(row.stats_at),
    verifyCron: String(row.verify_cron ?? ""),
    lastVerifyAt: row.last_verify_at === null ? null : Number(row.last_verify_at),
    lastVerifyStatus: String(row.last_verify_status ?? ""),
    lastVerifyDetail: String(row.last_verify_detail ?? ""),
  };
}

const SELECT = `SELECT r.*, (SELECT COUNT(*) FROM backup_jobs j WHERE j.repo_id = r.id) AS job_count
                FROM backup_repos r`;

export function listRepos(): BackupRepo[] {
  return (
    getDb()
      .prepare(`${SELECT} WHERE r.host_id = ? ORDER BY r.name COLLATE NOCASE`)
      .all(currentHostId()) as Record<string, string | number | null>[]
  ).map(toRepo);
}

export function getRepo(id: number): BackupRepo | null {
  const row = getDb()
    .prepare(`${SELECT} WHERE r.id = ? AND r.host_id = ?`)
    .get(id, currentHostId()) as Record<string, string | number | null> | undefined;
  return row ? toRepo(row) : null;
}

/** Motorun ihtiyaç duyduğu çözülmüş hâl — asla API yanıtına konmaz. */
export type RepoSecrets = {
  id: number;
  name: string;
  kind: RepoKind;
  location: string;
  password: string;
  /** restic'e giden ortam (SMB_/NFS_ hariç). */
  env: Record<string, string>;
  /** Volume bağlamak için SMB_/NFS_ alanları. */
  mountEnv: Record<string, string>;
  options: RepoOptions;
};

export function repoSecrets(id: number): RepoSecrets | null {
  const row = getDb()
    .prepare(
      "SELECT id, name, kind, location, password_enc, env_enc, options_json FROM backup_repos WHERE id = ? AND host_id = ?",
    )
    .get(id, currentHostId()) as Record<string, string | number> | undefined;
  if (!row) return null;

  const password = readEncrypted(String(row.password_enc ?? ""));
  if (password === null) return null;

  const all = parseEnv(readEncrypted(String(row.env_enc ?? "")) ?? "");
  const env: Record<string, string> = {};
  const mountEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(all)) {
    if (MOUNT_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) mountEnv[key] = value;
    else env[key] = value;
  }

  return {
    id: Number(row.id),
    name: String(row.name),
    kind: String(row.kind) as RepoKind,
    location: String(row.location),
    password,
    env,
    mountEnv,
    options: parseJson(row.options_json, DEFAULT_OPTIONS),
  };
}

/** Konum parolası — kurtarma kiti ve "parolayı göster" için. */
export function repoPassword(id: number): string | null {
  return repoSecrets(id)?.password ?? null;
}

export type RepoInput = {
  name: string;
  kind: string;
  location: string;
  /** Boşsa: yenide otomatik üretilir, düzenlemede mevcut parola korunur. */
  password: string;
  /** Yalnızca DOLU değerler yazılır; boş değer "aynı kalsın" demek. */
  env: Record<string, string>;
  options: Partial<RepoOptions>;
};

export function validateRepo(input: RepoInput, isNew: boolean): string | null {
  if (input.name.trim().length < 2) return serverT("backupStore.repoName");
  if (!REPO_KINDS.includes(input.kind as RepoKind)) return serverT("backupStore.repoKind");
  const location = input.location.trim();
  if (location.length === 0) return serverT("backupStore.repoLocation");

  switch (input.kind as RepoKind) {
    case "local":
      if (!location.startsWith("/") || location.includes("..")) return serverT("backupStore.localPath");
      // Yedeği yedeklenen verinin yanına koymak, tek bir disk arızasında
      // ikisini birden kaybetmek demektir. En tehlikeli yerler reddediliyor.
      if (location === "/" || /^\/(proc|sys|dev|run)(\/|$)/.test(location)) {
        return serverT("backupStore.forbiddenRepo");
      }
      break;
    case "smb":
      if (!/^\/\/[^/\s]+\/[^/\s]+(\/.*)?$/.test(location)) return serverT("backupStore.smbLocation");
      break;
    case "nfs":
      if (!/^[^:/\s]+:\/\S*$/.test(location)) return serverT("backupStore.nfsLocation");
      break;
    case "s3":
      if (!/^s3:\S+$/.test(location)) return serverT("backupStore.s3Location");
      if (isNew && (!input.env.AWS_ACCESS_KEY_ID || !input.env.AWS_SECRET_ACCESS_KEY)) {
        return serverT("backupStore.s3Keys");
      }
      break;
    case "rclone":
      if (!/^rclone:\S+$/.test(location)) return serverT("backupStore.rcloneLocation");
      break;
  }

  if (input.password.length > 0 && input.password.length < 8) {
    return serverT("backupStore.repoPassword");
  }
  if (
    getDb()
      .prepare("SELECT 1 FROM backup_repos WHERE name = ? COLLATE NOCASE AND host_id = ?")
      .get(input.name.trim(), currentHostId()) &&
    isNew
  ) {
    return serverT("backupStore.repoNameTaken");
  }
  return null;
}

function cleanOptions(options: Partial<RepoOptions>): RepoOptions {
  const limit = (value: unknown) => Math.max(0, Math.min(10_000_000, Math.round(Number(value) || 0)));
  return { limitUploadKb: limit(options.limitUploadKb), limitDownloadKb: limit(options.limitDownloadKb) };
}

/** Otomatik ad: çakışırsa "ad-2", "ad-3"… */
export function uniqueRepoName(base: string): string {
  const exists = (name: string) =>
    Boolean(
      getDb()
        .prepare("SELECT 1 FROM backup_repos WHERE name = ? COLLATE NOCASE AND host_id = ?")
        .get(name, currentHostId()),
    );
  const clean = base.trim().slice(0, 60) || "yedek";
  if (!exists(clean)) return clean;
  for (let index = 2; index < 1000; index += 1) {
    if (!exists(`${clean}-${index}`)) return `${clean}-${index}`;
  }
  return `${clean}-${Date.now()}`;
}

/** Restic depo parolası: 32 karakter, URL-güvenli. */
export function generatePassword(): string {
  return randomBytes(24).toString("base64url");
}

export function createRepo(input: RepoInput): { id: number; password: string } {
  const password = input.password.length > 0 ? input.password : generatePassword();
  const env = serializeEnv(input.env);
  const info = getDb()
    .prepare(
      `INSERT INTO backup_repos (host_id, name, kind, location, password_enc, env_enc, options_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      currentHostId(),
      input.name.trim(),
      input.kind,
      input.location.trim(),
      JSON.stringify(encryptSecret(password)),
      env ? JSON.stringify(encryptSecret(env)) : "",
      JSON.stringify(cleanOptions(input.options)),
    );
  return { id: Number(info.lastInsertRowid), password };
}

export function updateRepo(id: number, input: RepoInput): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT env_enc FROM backup_repos WHERE id = ? AND host_id = ?")
    .get(id, currentHostId()) as { env_enc: string } | undefined;
  if (!row) return false;

  db.prepare(
    "UPDATE backup_repos SET name = ?, kind = ?, location = ?, options_json = ? WHERE id = ?",
  ).run(input.name.trim(), input.kind, input.location.trim(), JSON.stringify(cleanOptions(input.options)), id);

  // Parola yalnızca YENİ bir değer girildiyse değişir. Boş bırakmak "aynı
  // kalsın" demek; aksi halde her düzenleme parolayı silerdi.
  if (input.password.length > 0) {
    db.prepare("UPDATE backup_repos SET password_enc = ?, initialized = 0 WHERE id = ?").run(
      JSON.stringify(encryptSecret(input.password)),
      id,
    );
  }

  const merged = { ...parseEnv(readEncrypted(row.env_enc) ?? ""), ...nonEmpty(input.env) };
  const env = serializeEnv(merged);
  db.prepare("UPDATE backup_repos SET env_enc = ? WHERE id = ?").run(
    env ? JSON.stringify(encryptSecret(env)) : "",
    id,
  );
  return true;
}

function nonEmpty(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value.length > 0));
}

export function deleteRepo(id: number): { ok: boolean; error?: string } {
  const jobs = getDb()
    .prepare("SELECT COUNT(*) AS n FROM backup_jobs WHERE repo_id = ?")
    .get(id) as { n: number };
  if (Number(jobs.n) > 0) {
    return { ok: false, error: serverT("backupStore.repoInUse", { count: jobs.n }) };
  }
  // Konum KAYDI siliniyor, deponun kendisi değil: diskteki restic verisine
  // panel dokunmuyor. Yanlışlıkla silinen bir kayıt yeniden eklenebilir.
  getDb().prepare("DELETE FROM backup_repos WHERE id = ? AND host_id = ?").run(id, currentHostId());
  return { ok: true };
}

export function markRepoChecked(id: number, initialized: boolean, error: string): void {
  getDb()
    .prepare(
      "UPDATE backup_repos SET initialized = ?, last_check_at = unixepoch(), last_error = ? WHERE id = ?",
    )
    .run(initialized ? 1 : 0, error.slice(0, 2000), id);
}

export function saveRepoStats(id: number, stats: RepoStats): void {
  getDb()
    .prepare("UPDATE backup_repos SET stats_json = ?, stats_at = unixepoch() WHERE id = ?")
    .run(JSON.stringify(stats), id);
}

export function markRepoVerified(id: number, status: "ok" | "error", detail: string): void {
  getDb()
    .prepare(
      `UPDATE backup_repos SET last_verify_at = unixepoch(), last_verify_status = ?,
         last_verify_detail = ? WHERE id = ?`,
    )
    .run(status, detail.slice(0, 2000), id);
}

export function setVerifyCron(id: number, cron: string): void {
  getDb()
    .prepare("UPDATE backup_repos SET verify_cron = ? WHERE id = ? AND host_id = ?")
    .run(cron.trim(), id, currentHostId());
}
