/**
 * Yedekleme v2 — paylaşılan tipler (sunucu + istemci).
 *
 * Üç "sistem" (Docker, İşletim Sistemi, Veritabanı) birer iş olarak tutulur;
 * kullanıcının elle tanımladığı eski tip işler `custom` kategorisindedir.
 */

export type RepoKind = "local" | "smb" | "nfs" | "s3" | "rclone";
export const REPO_KINDS: readonly RepoKind[] = ["local", "smb", "nfs", "s3", "rclone"];

export type SystemCategory = "docker" | "os" | "database";
export type Category = SystemCategory | "custom";
export const SYSTEM_CATEGORIES: readonly SystemCategory[] = ["docker", "os", "database"];

export type SourceKind = "volume" | "host_dir" | "panel_db" | "container" | "db";

export type RunKind = "backup" | "restore" | "verify";
/** `warning`: yedek alındı ama eksik (restic çıkış 3) ya da anormal boyut. */
export type RunStatus = "running" | "ok" | "warning" | "error" | "cancelled";

export type RepoOptions = {
  /** KB/sn; 0 = sınırsız. Yalnızca s3/rclone'da anlamlı. */
  limitUploadKb: number;
  limitDownloadKb: number;
};

export type RepoStats = {
  /** Depoda diskte kaplanan (sıkıştırılmış) boyut. */
  storedBytes: number;
  /** Sıkıştırma öncesi boyut. */
  rawBytes: number;
  snapshots: number;
  /** Yalnızca local/smb/nfs: hedef diskteki boş ve toplam alan. */
  freeBytes: number | null;
  totalBytes: number | null;
};

export type BackupRepo = {
  id: number;
  name: string;
  kind: RepoKind;
  location: string;
  /** Hangi gizli alanların kayıtlı olduğu (değerleri ASLA istemciye gitmez). */
  envKeys: string[];
  /** Gizli olmayan alanlar (ör. S3 bölgesi, SMB kullanıcı adı) — form için. */
  publicEnv: Record<string, string>;
  hasPassword: boolean;
  /** MASTER_KEY değiştiyse parola çözülemez; bu durumda depo kullanılamaz. */
  passwordReadable: boolean;
  initialized: boolean;
  lastCheckAt: number | null;
  lastError: string;
  jobCount: number;
  options: RepoOptions;
  stats: RepoStats | null;
  statsAt: number | null;
  verifyCron: string;
  lastVerifyAt: number | null;
  lastVerifyStatus: string;
  lastVerifyDetail: string;
};

export type JobOptions = {
  /** Docker: sonradan kurulan container'lar kendiliğinden yedeğe girsin. */
  autoInclude: boolean;
  /** Hata olursa 15 dk arayla 2 kez yeniden dene. */
  retry: boolean;
  /** Yedekten önce hedefteki boş alanı kontrol et (%10 altı uyarı). */
  spaceCheck: boolean;
  /** restic düşük CPU/disk önceliğinde çalışsın. */
  lowPriority: boolean;
  /** Ortalamaya göre anormal boyut değişiminde uyar. */
  anomaly: boolean;
  /** Ek restic --exclude desenleri. */
  excludes: string[];
};

export const DEFAULT_JOB_OPTIONS: JobOptions = {
  autoInclude: true,
  retry: true,
  spaceCheck: true,
  lowPriority: true,
  anomaly: true,
  excludes: [],
};

export type SourceOptions = {
  /** Container'ı yedek sırasında durdur. */
  stop?: boolean;
  /** v1'den taşınan tek kaynak — `/data` altına bağlanır. */
  legacy?: boolean;
};

export type BackupSource = {
  id: number;
  kind: SourceKind;
  ref: string;
  enabled: boolean;
  options: SourceOptions;
};

export type BackupJob = {
  id: number;
  name: string;
  category: Category;
  repoId: number;
  repoName: string;
  scheduleCron: string;
  keepLast: number;
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
  notifySuccess: boolean;
  options: JobOptions;
  /** Yalnızca custom işler: satır başına bir container. */
  quiesce: string;
  enabled: boolean;
  lastRunAt: number | null;
  lastStatus: string;
  retryAt: number | null;
  attempt: number;
  sources: BackupSource[];
};

export type BackupRun = {
  id: number;
  jobId: number;
  jobName: string;
  category: Category;
  kind: RunKind;
  startedAt: number;
  finishedAt: number | null;
  status: RunStatus;
  snapshotId: string;
  filesNew: number;
  filesChanged: number;
  bytesAdded: number;
  bytesProcessed: number;
  filesTotal: number;
  durationMs: number;
  pruned: number;
  detail: string;
  actor: string;
  attempt: number;
  anomaly: string;
};

export type Snapshot = {
  id: string;
  shortId: string;
  time: number;
  hostname: string;
  paths: string[];
  tags: string[];
  /** restic ≥ 0.17 snapshot özeti; yoksa null. */
  sizeBytes: number | null;
  filesTotal: number | null;
};

export type SnapshotEntry = {
  path: string;
  name: string;
  type: "dir" | "file" | "symlink" | "other";
  size: number;
  mtime: number | null;
};

export type SnapshotDiff = {
  added: string[];
  removed: string[];
  changed: string[];
  addedBytes: number;
  removedBytes: number;
};

export type LivePhase =
  | "queued"
  | "preparing"
  | "dumping"
  | "stopping"
  | "scanning"
  | "uploading"
  | "starting"
  | "pruning"
  | "finishing"
  | "restoring"
  | "verifying";

export type LiveProgress = {
  runId: number;
  jobId: number;
  category: Category;
  kind: RunKind;
  phase: LivePhase;
  /** 0–100; bilinmiyorsa null. */
  percent: number | null;
  filesDone: number;
  totalFiles: number;
  bytesDone: number;
  totalBytes: number;
  currentFiles: string[];
  startedAt: number;
  secondsRemaining: number | null;
  /** Son durum satırı / not. */
  message: string;
  done: boolean;
  status: RunStatus;
};

/* --- Otomatik bulma --- */

export type DockerMount = {
  type: "volume" | "bind";
  /** volume adı ya da host yolu */
  source: string;
  destination: string;
  /** Sistem yolu (/, /proc, docker.sock …) — yedeğe girmez. */
  skipped: boolean;
};

export type DockerItem = {
  name: string;
  image: string;
  state: string;
  mounts: DockerMount[];
  composeProject: string;
  composeDir: string;
  /** İmajdan veritabanı olduğu anlaşılıyor (dökümü Veritabanı bölümünde). */
  isDatabase: boolean;
  /** Panelin kendi container'ı (verisi Veritabanı bölümünde). */
  isSelf: boolean;
  /** SQLite benzeri dosya tabanlı veri — "durdur" önerilir. */
  suggestStop: boolean;
  selected: boolean;
  stop: boolean;
};

export type OsItem = {
  path: string;
  recommended: boolean;
  selected: boolean;
};

export type DbEngineKind = "postgres" | "mysql";

export type DbItem = {
  /** container adı; panel veritabanı için "panel". */
  ref: string;
  kind: "db" | "panel_db";
  engine: DbEngineKind | "sqlite";
  image: string;
  state: string;
  /** Kimlik bilgisi nereden: container env, panel bağlantısı ya da yok. */
  credentials: "env" | "connection" | "missing" | "none";
  selected: boolean;
};
