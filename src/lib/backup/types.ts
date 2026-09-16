export type RepoKind = "local" | "rclone" | "s3";
export type SourceKind = "volume" | "host_dir" | "panel_db";
export type RunStatus = "running" | "ok" | "error";

export type BackupRepo = {
  id: number;
  name: string;
  kind: RepoKind;
  location: string;
  /** Parola girilmiş mi — değerin kendisi hiçbir zaman istemciye gitmez. */
  hasPassword: boolean;
  /** MASTER_KEY değiştiyse parola çözülemez; bu durumda depo kullanılamaz. */
  passwordReadable: boolean;
  initialized: boolean;
  lastCheckAt: number | null;
  lastError: string;
  jobCount: number;
};

export type BackupJob = {
  id: number;
  name: string;
  repoId: number;
  repoName: string;
  sourceKind: SourceKind;
  source: string;
  scheduleCron: string;
  quiesce: string;
  excludes: string;
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
  enabled: boolean;
  lastRunAt: number | null;
  lastStatus: string;
};

export type BackupRun = {
  id: number;
  jobId: number;
  jobName: string;
  startedAt: number;
  finishedAt: number | null;
  status: RunStatus;
  snapshotId: string;
  filesNew: number;
  filesChanged: number;
  bytesAdded: number;
  durationMs: number;
  pruned: number;
  detail: string;
  actor: string;
};

export type Snapshot = {
  id: string;
  shortId: string;
  time: number;
  hostname: string;
  paths: string[];
  tags: string[];
  sizeBytes: number | null;
};
