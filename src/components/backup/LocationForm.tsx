"use client";

import { useState } from "react";
import { Cloud, FolderOpen, HardDrive, Network, Server } from "lucide-react";

import { DirBrowser } from "@/components/settings/DirPicker";
import type { BackupRepo, RepoKind } from "@/lib/backup/types";
import { useT } from "@/lib/i18n/client";
import { inputClass, smallButtonClass } from "./client";

/**
 * Konum formu — türe göre alanlar. Kullanıcı restic adres sözdizimini
 * bilmek zorunda değil: alanlardan adres panelde kurulur.
 */

export type LocationDraft = {
  id?: number;
  name: string;
  kind: RepoKind;
  path: string;
  server: string;
  share: string;
  subPath: string;
  username: string;
  secret: string;
  domain: string;
  nfsOptions: string;
  endpoint: string;
  bucket: string;
  region: string;
  rcloneRemote: string;
  rcloneEnv: string;
  limitUploadKb: number;
  limitDownloadKb: number;
};

export const EMPTY_LOCATION: LocationDraft = {
  name: "",
  kind: "local",
  path: "",
  server: "",
  share: "",
  subPath: "",
  username: "",
  secret: "",
  domain: "",
  nfsOptions: "",
  endpoint: "",
  bucket: "",
  region: "",
  rcloneRemote: "",
  rcloneEnv: "",
  limitUploadKb: 0,
  limitDownloadKb: 0,
};

const KINDS: { kind: RepoKind; icon: typeof HardDrive }[] = [
  { kind: "local", icon: HardDrive },
  { kind: "smb", icon: Network },
  { kind: "nfs", icon: Server },
  { kind: "s3", icon: Cloud },
  { kind: "rclone", icon: Cloud },
];

/** Var olan konumu forma açar (gizli alanlar boş: "değiştirme"). */
export function draftFromRepo(repo: BackupRepo): LocationDraft {
  const draft: LocationDraft = {
    ...EMPTY_LOCATION,
    id: repo.id,
    name: repo.name,
    kind: repo.kind,
    limitUploadKb: repo.options.limitUploadKb,
    limitDownloadKb: repo.options.limitDownloadKb,
  };
  if (repo.kind === "local") draft.path = repo.location;
  if (repo.kind === "smb") {
    const match = /^\/\/([^/]+)\/([^/]+)(\/.*)?$/.exec(repo.location);
    draft.server = match?.[1] ?? "";
    draft.share = match?.[2] ?? "";
    draft.subPath = match?.[3] ?? "";
    draft.username = repo.publicEnv.SMB_USERNAME ?? "";
    draft.domain = repo.publicEnv.SMB_DOMAIN ?? "";
  }
  if (repo.kind === "nfs") {
    const [server, ...rest] = repo.location.split(":");
    draft.server = server;
    draft.path = rest.join(":");
    draft.nfsOptions = repo.publicEnv.NFS_OPTIONS ?? "";
  }
  if (repo.kind === "s3") {
    const match = /^s3:(https?:\/\/[^/]+)\/([^/]+)(\/.*)?$/.exec(repo.location);
    draft.endpoint = match?.[1] ?? "";
    draft.bucket = match?.[2] ?? "";
    draft.subPath = match?.[3] ?? "";
    draft.region = repo.publicEnv.AWS_DEFAULT_REGION ?? "";
    draft.username = repo.publicEnv.AWS_ACCESS_KEY_ID ?? "";
  }
  if (repo.kind === "rclone") draft.rcloneRemote = repo.location.replace(/^rclone:/, "");
  return draft;
}

/** Formdan API gövdesi. */
export function locationPayload(draft: LocationDraft) {
  const env: Record<string, string> = {};
  let location = "";
  const clean = (value: string) => value.trim().replace(/\/+$/, "");
  switch (draft.kind) {
    case "local":
      location = clean(draft.path);
      break;
    case "smb": {
      const sub = clean(draft.subPath).replace(/^\/*/, "");
      location = `//${draft.server.trim()}/${draft.share.trim()}${sub ? `/${sub}` : ""}`;
      env.SMB_USERNAME = draft.username.trim();
      env.SMB_PASSWORD = draft.secret;
      env.SMB_DOMAIN = draft.domain.trim();
      break;
    }
    case "nfs":
      location = `${draft.server.trim()}:${clean(draft.path).startsWith("/") ? clean(draft.path) : `/${clean(draft.path)}`}`;
      env.NFS_OPTIONS = draft.nfsOptions.trim();
      break;
    case "s3": {
      const sub = clean(draft.subPath).replace(/^\/*/, "");
      const endpoint = clean(draft.endpoint) || "https://s3.amazonaws.com";
      location = `s3:${endpoint}/${draft.bucket.trim()}${sub ? `/${sub}` : ""}`;
      env.AWS_ACCESS_KEY_ID = draft.username.trim();
      env.AWS_SECRET_ACCESS_KEY = draft.secret;
      env.AWS_DEFAULT_REGION = draft.region.trim();
      break;
    }
    case "rclone":
      location = `rclone:${draft.rcloneRemote.trim()}`;
      for (const line of draft.rcloneEnv.split("\n")) {
        const index = line.indexOf("=");
        if (index > 0) env[line.slice(0, index).trim()] = line.slice(index + 1).trim();
      }
      break;
  }
  return {
    name: draft.name.trim() || defaultName(draft),
    kind: draft.kind,
    location,
    env,
    options: { limitUploadKb: draft.limitUploadKb, limitDownloadKb: draft.limitDownloadKb },
  };
}

function defaultName(draft: LocationDraft): string {
  if (draft.kind === "local") return draft.path.split("/").filter(Boolean).pop() ?? "yedek";
  if (draft.kind === "smb") return `${draft.server}-${draft.share}`;
  if (draft.kind === "nfs") return draft.server;
  if (draft.kind === "s3") return draft.bucket;
  return draft.rcloneRemote.split(":")[0] || "rclone";
}

export function LocationForm({
  draft,
  onChange,
  editing = false,
}: {
  draft: LocationDraft;
  onChange: (draft: LocationDraft) => void;
  editing?: boolean;
}) {
  const t = useT();
  const [browsing, setBrowsing] = useState(false);
  const set = (patch: Partial<LocationDraft>) => onChange({ ...draft, ...patch });
  const field = (key: keyof LocationDraft, label: string, options: { type?: string; placeholder?: string; hint?: string; mono?: boolean } = {}) => (
    <label className="block text-sm">
      <span className="mb-1 block text-subtle">{label}</span>
      <input
        type={options.type ?? "text"}
        className={`${inputClass} ${options.mono ? "font-mono" : ""}`}
        placeholder={options.placeholder}
        value={String(draft[key] ?? "")}
        autoComplete={options.type === "password" ? "new-password" : "off"}
        onChange={(event) =>
          set({ [key]: options.type === "number" ? Number(event.target.value) : event.target.value } as Partial<LocationDraft>)
        }
      />
      {options.hint && <span className="mt-1 block text-xs text-subtle">{options.hint}</span>}
    </label>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {KINDS.map(({ kind, icon: Icon }) => (
          <button
            key={kind}
            type="button"
            disabled={editing && kind !== draft.kind}
            onClick={() => set({ kind })}
            className={`flex flex-col items-center gap-1 rounded-lg border p-3 text-xs transition-colors disabled:opacity-40 ${
              draft.kind === kind ? "border-brand bg-brand/10 text-brand" : "border-line hover:border-brand"
            }`}
          >
            <Icon className="size-5" aria-hidden />
            {t(`backup.locationKind.${kind}`)}
          </button>
        ))}
      </div>
      <p className="text-xs text-subtle">{t(`backup.locationKind.hint.${draft.kind}`)}</p>

      {draft.kind === "local" && (
        <div className="text-sm">
          <span className="mb-1 block text-subtle">{t("backup.location.folder")}</span>
          <div className="flex gap-2">
            <input
              className={`${inputClass} font-mono`}
              value={draft.path}
              placeholder={t("backup.location.folderPlaceholder")}
              onChange={(event) => set({ path: event.target.value })}
            />
            <button type="button" className={smallButtonClass} onClick={() => setBrowsing(true)}>
              <FolderOpen className="size-3.5" aria-hidden /> {t("backup.common.browse")}
            </button>
          </div>
          <span className="mt-1 block text-xs text-subtle">{t("backup.location.folderHint")}</span>
          <DirBrowser
            open={browsing}
            title={t("backup.location.folder")}
            startPath={draft.path || "/mnt"}
            onClose={() => setBrowsing(false)}
            onPick={(path) => {
              setBrowsing(false);
              set({ path });
            }}
          />
        </div>
      )}

      {draft.kind === "smb" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {field("server", t("backup.location.server"), { placeholder: "192.168.1.10" })}
          {field("share", t("backup.location.share"), { placeholder: "yedek" })}
          {field("subPath", t("backup.location.subPath"), { placeholder: "sunucu-paneli", mono: true })}
          {field("domain", t("backup.location.domain"), { placeholder: "WORKGROUP" })}
          {field("username", t("backup.location.username"))}
          {field("secret", t("backup.location.password"), {
            type: "password",
            placeholder: editing ? t("backup.location.keepSecret") : "",
          })}
        </div>
      )}

      {draft.kind === "nfs" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {field("server", t("backup.location.server"), { placeholder: "192.168.1.10" })}
          {field("path", t("backup.location.exportPath"), { placeholder: "/volume1/yedek", mono: true })}
          {field("nfsOptions", t("backup.location.nfsOptions"), { placeholder: "rw,nfsvers=4", mono: true })}
        </div>
      )}

      {draft.kind === "s3" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {field("endpoint", t("backup.location.endpoint"), {
            placeholder: "https://s3.eu-central-003.backblazeb2.com",
            hint: t("backup.location.endpointHint"),
            mono: true,
          })}
          {field("bucket", t("backup.location.bucket"))}
          {field("subPath", t("backup.location.prefix"), { placeholder: "sunucu-paneli", mono: true })}
          {field("region", t("backup.location.region"), { placeholder: "eu-central-1" })}
          {field("username", t("backup.location.accessKey"))}
          {field("secret", t("backup.location.secretKey"), {
            type: "password",
            placeholder: editing ? t("backup.location.keepSecret") : "",
          })}
        </div>
      )}

      {draft.kind === "rclone" && (
        <div className="space-y-3">
          {field("rcloneRemote", t("backup.location.rcloneRemote"), { placeholder: "gdrive:yedek", mono: true })}
          <label className="block text-sm">
            <span className="mb-1 block text-subtle">{t("backup.location.rcloneEnv")}</span>
            <textarea
              rows={3}
              className={`${inputClass} font-mono text-xs`}
              placeholder="RCLONE_CONFIG_GDRIVE_TYPE=drive"
              value={draft.rcloneEnv}
              onChange={(event) => set({ rcloneEnv: event.target.value })}
            />
          </label>
        </div>
      )}

      {(draft.kind === "s3" || draft.kind === "rclone") && (
        <div className="grid gap-3 sm:grid-cols-2">
          {field("limitUploadKb", t("backup.location.limitUpload"), { type: "number", hint: t("backup.location.limitHint") })}
          {field("limitDownloadKb", t("backup.location.limitDownload"), { type: "number" })}
        </div>
      )}

      {field("name", t("backup.location.name"), { placeholder: defaultName(draft) })}
    </div>
  );
}
