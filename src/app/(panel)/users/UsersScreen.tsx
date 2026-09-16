"use client";

import { useState } from "react";
import {
  KeyRound,
  LockOpen,
  Monitor,
  Plus,
  ShieldCheck,
  ShieldOff,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { Modal } from "@/components/Modal";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import type {
  ManagedRole,
  ManagedUser,
  PermissionInfo,
  UserSession,
} from "@/lib/auth/users";
import { useFormat, useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";

/**
 * M3.1 — kullanıcı, rol ve oturum yönetimi tek ekranda.
 *
 * Üçü ayrı sayfa değil sekme: aralarındaki bağ sürekli. "Bu role dokunursam
 * kim etkilenir", "rolü değiştirdim, oturumu düştü mü" sorularının cevabı bir
 * tık ötede olmalı.
 */

type Directory = {
  users: ManagedUser[];
  roles: ManagedRole[];
  permissions: PermissionInfo[];
  sessions: UserSession[];
};

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}


/** İzinler nokta öncesi ön ekle gruplanıyor: 30 satırlık düz liste okunmuyor. */
function groupPermissions(permissions: PermissionInfo[]): [string, PermissionInfo[]][] {
  const groups = new Map<string, PermissionInfo[]>();
  for (const permission of permissions) {
    const prefix = permission.key.split(".")[0];
    const bucket = groups.get(prefix);
    if (bucket) bucket.push(permission);
    else groups.set(prefix, [permission]);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

const GROUP_LABELS: Record<string, MessageKey> = {
  panel: "users.group.panel",
  metrics: "users.group.metrics",
  monitors: "users.group.monitors",
  logs: "users.group.logs",
  docker: "users.group.docker",
  host: "users.group.host",
  apps: "users.group.apps",
  kiosk: "users.group.kiosk",
  proxy: "users.group.proxy",
  network: "users.group.network",
  files: "users.group.files",
  db: "users.group.db",
  backup: "users.group.backup",
  security: "users.group.security",
  cron: "users.group.cron",
  repos: "users.group.repos",
  vault: "users.group.vault",
  settings: "users.group.settings",
  users: "users.group.users",
  audit: "users.group.audit",
};

/** Son giriş / son etkinlik: hiç yoksa "hiç", varsa göreli süre. */
function useTimeAgo() {
  const t = useT();
  const f = useFormat();
  return (seconds: number | null) => (seconds ? f.relative(seconds * 1000) : t("users.never"));
}

type Tab = "users" | "roles" | "sessions";

export function UsersScreen({
  initial,
  currentUserId,
}: {
  initial: Directory;
  currentUserId: number;
}) {
  const t = useT();
  const [directory, setDirectory] = useState(initial);
  const [tab, setTab] = useState<Tab>("users");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function call(path: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, {
        method,
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        setError(String(data.error ?? t("common.errors.actionFailed")));
        return false;
      }
      if (data.users) setDirectory(data as unknown as Directory);
      return true;
    } catch {
      setError(t("common.errors.network"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const tabs: { key: Tab; label: string; count: number; icon: typeof Users }[] = [
    { key: "users", label: t("users.tab.users"), count: directory.users.length, icon: Users },
    { key: "roles", label: t("users.tab.roles"), count: directory.roles.length, icon: ShieldCheck },
    { key: "sessions", label: t("users.tab.sessions"), count: directory.sessions.length, icon: Monitor },
  ];

  return (
    <div className="space-y-4">
      <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((entry) => {
          const Icon = entry.icon;
          return (
            <button
              key={entry.key}
              type="button"
              onClick={() => setTab(entry.key)}
              className={`-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${
                tab === entry.key
                  ? "border-brand font-medium text-brand"
                  : "border-transparent text-subtle hover:text-ink"
              }`}
            >
              <Icon className="size-4" aria-hidden />
              {entry.label}
              <span className="text-xs text-subtle">{entry.count}</span>
            </button>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {tab === "users" && (
        <UsersTab
          directory={directory}
          currentUserId={currentUserId}
          busy={busy}
          call={call}
        />
      )}
      {tab === "roles" && <RolesTab directory={directory} busy={busy} call={call} />}
      {tab === "sessions" && <SessionsTab directory={directory} busy={busy} call={call} />}
    </div>
  );
}

type CallFn = (path: string, method: string, body?: unknown) => Promise<boolean>;

function UsersTab({
  directory,
  currentUserId,
  busy,
  call,
}: {
  directory: Directory;
  currentUserId: number;
  busy: boolean;
  call: CallFn;
}) {
  const t = useT();
  const timeAgo = useTimeAgo();
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<ManagedUser | null>(null);

  return (
    <>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          <UserPlus className="size-4" /> {t("users.addUser")}
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="rtable w-full min-w-[54rem] text-sm">
          <thead className="border-b border-line text-left text-xs text-subtle">
            <tr>
              <th className="px-4 py-2.5 font-medium">{t("users.col.user")}</th>
              <th className="px-4 py-2.5 font-medium">{t("users.col.role")}</th>
              <th className="px-4 py-2.5 font-medium">{t("users.col.status")}</th>
              <th className="px-4 py-2.5 font-medium">2FA</th>
              <th className="px-4 py-2.5 font-medium">{t("users.col.lastLogin")}</th>
              <th className="px-4 py-2.5 font-medium">{t("users.col.sessions")}</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {directory.users.map((user) => {
              const locked = user.locked;
              return (
                <tr key={user.id}>
                  <td data-label="" className="px-4 py-2.5">
                    <div className="font-medium">{user.displayName}</div>
                    <div className="font-mono text-xs text-subtle">
                      {user.username}
                      {user.id === currentUserId && t("users.you")}
                    </div>
                  </td>
                  <td data-label={t("users.col.role")} className="px-4 py-2.5">
                    <select
                      value={user.roleId}
                      disabled={busy}
                      onChange={(e) =>
                        void call(`/api/users/${user.id}`, "PATCH", {
                          roleId: Number(e.target.value),
                        })
                      }
                      className="rounded-md border border-line bg-canvas px-2 py-1 text-sm outline-none focus:border-brand disabled:opacity-50"
                    >
                      {directory.roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td data-label={t("users.col.status")} className="px-4 py-2.5">
                    <label className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={user.isActive}
                        disabled={busy}
                        onChange={(e) =>
                          void call(`/api/users/${user.id}`, "PATCH", {
                            isActive: e.target.checked,
                          })
                        }
                        className="size-3.5 accent-[var(--brand)]"
                      />
                      {user.isActive ? t("users.active") : t("users.inactive")}
                    </label>
                    {locked && (
                      <div className="mt-0.5 text-xs text-warn">
                        {t("users.locked", { count: user.failedAttempts })}
                      </div>
                    )}
                    {user.mustChangePassword && (
                      <div className="mt-0.5 text-xs text-subtle">{t("users.mustChange")}</div>
                    )}
                  </td>
                  <td data-label="2FA" className="px-4 py-2.5">
                    {user.totpEnabled ? (
                      <span className="flex items-center gap-1 text-xs text-ok">
                        <ShieldCheck className="size-3.5" aria-hidden /> {t("users.twoFactorOn")}
                        <span className="text-subtle">
                          {t("users.recoveryLeft", { count: user.recoveryLeft })}
                        </span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-subtle">
                        <ShieldOff className="size-3.5" aria-hidden /> {t("users.twoFactorOff")}
                      </span>
                    )}
                  </td>
                  <td data-label={t("users.col.lastLogin")} className="px-4 py-2.5 text-xs text-subtle">
                    {timeAgo(user.lastLoginAt)}
                  </td>
                  <td data-label={t("users.col.sessions")} className="px-4 py-2.5 text-xs tabular-nums">{user.activeSessions}</td>
                  <td data-label="" className="px-4 py-2.5">
                    <div className="flex flex-wrap justify-end gap-1 max-md:justify-start">
                      <button
                        type="button"
                        title={t("users.resetPassword")}
                        onClick={() => setResetting(user)}
                        disabled={busy}
                        className="rounded border border-line p-1.5 text-subtle transition-colors hover:text-ink disabled:opacity-50"
                      >
                        <KeyRound className="size-3.5" />
                      </button>
                      {locked && (
                        <button
                          type="button"
                          title={t("users.unlock")}
                          onClick={() =>
                            void call(`/api/users/${user.id}`, "POST", { action: "unlock" })
                          }
                          disabled={busy}
                          className="rounded border border-line p-1.5 text-warn transition-colors hover:border-warn disabled:opacity-50"
                        >
                          <LockOpen className="size-3.5" />
                        </button>
                      )}
                      {user.totpEnabled && (
                        <button
                          type="button"
                          title={t("users.reset2fa")}
                          onClick={() => {
                            if (
                              confirm(t("users.confirmReset2fa", { name: user.username }))
                            ) {
                              void call(`/api/users/${user.id}`, "POST", { action: "reset-2fa" });
                            }
                          }}
                          disabled={busy}
                          className="rounded border border-line p-1.5 text-subtle transition-colors hover:text-warn disabled:opacity-50"
                        >
                          <ShieldOff className="size-3.5" />
                        </button>
                      )}
                      {user.id !== currentUserId && (
                        <button
                          type="button"
                          title={t("common.actions.delete")}
                          onClick={() => {
                            if (confirm(t("users.confirmDelete", { name: user.username }))) {
                              void call(`/api/users/${user.id}`, "DELETE");
                            }
                          }}
                          disabled={busy}
                          className="rounded border border-line p-1.5 text-subtle transition-colors hover:text-danger disabled:opacity-50"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <AddUserModal
        open={adding}
        roles={directory.roles}
        busy={busy}
        onClose={() => setAdding(false)}
        onSubmit={async (body) => {
          if (await call("/api/users", "POST", body)) setAdding(false);
        }}
      />

      <ResetPasswordModal
        user={resetting}
        busy={busy}
        onClose={() => setResetting(null)}
        onSubmit={async (password, mustChange) => {
          if (
            resetting &&
            (await call(`/api/users/${resetting.id}`, "POST", {
              action: "reset-password",
              password,
              mustChange,
            }))
          ) {
            setResetting(null);
          }
        }}
      />
    </>
  );
}

function AddUserModal({
  open,
  roles,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  roles: ManagedRole[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const t = useT();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState(roles[0]?.id ?? 1);
  const [mustChange, setMustChange] = useState(true);

  const inputClass =
    "mt-1 w-full rounded-md border border-line bg-canvas px-3 py-1.5 text-sm outline-none focus:border-brand";

  return (
    <Modal open={open} title={t("users.addUser")} onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="text-subtle">{t("users.form.username")}</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={`${inputClass} font-mono`}
          />
        </label>
        <label className="block text-sm">
          <span className="text-subtle">{t("users.form.displayName")}</span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block text-sm">
          <span className="text-subtle">{t("users.form.initialPassword")}</span>
          <input
            type="text"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${inputClass} font-mono`}
          />
          <span className="mt-1 block text-xs text-subtle">
            {t("users.form.passwordRule")}
          </span>
        </label>
        <label className="block text-sm">
          <span className="text-subtle">{t("users.col.role")}</span>
          <select
            value={roleId}
            onChange={(e) => setRoleId(Number(e.target.value))}
            className={inputClass}
          >
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {t("users.form.rolePermissions", { name: role.name, count: role.permissions.length })}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={mustChange}
            onChange={(e) => setMustChange(e.target.checked)}
            className="size-4 accent-[var(--brand)]"
          />
          {t("users.form.mustChangeFirst")}
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:text-ink"
          >
            {t("common.actions.cancel")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              onSubmit({ username, displayName, password, roleId, mustChangePassword: mustChange })
            }
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {t("common.actions.add")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ResetPasswordModal({
  user,
  busy,
  onClose,
  onSubmit,
}: {
  user: ManagedUser | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (password: string, mustChange: boolean) => void;
}) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [mustChange, setMustChange] = useState(true);

  return (
    <Modal
      open={user !== null}
      title={t("users.resetModal.title", { name: user?.username ?? "" })}
      onClose={onClose}
    >
      <div className="space-y-3">
        <p className="text-xs text-subtle">
          {t("users.resetModal.intro")}
        </p>
        <label className="block text-sm">
          <span className="text-subtle">{t("users.resetModal.newPassword")}</span>
          <input
            type="text"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-canvas px-3 py-1.5 font-mono text-sm outline-none focus:border-brand"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={mustChange}
            onChange={(e) => setMustChange(e.target.checked)}
            className="size-4 accent-[var(--brand)]"
          />
          {t("users.resetModal.mustChange")}
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:text-ink"
          >
            {t("common.actions.cancel")}
          </button>
          <button
            type="button"
            disabled={busy || !password}
            onClick={() => onSubmit(password, mustChange)}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {t("users.resetModal.submit")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function RolesTab({
  directory,
  busy,
  call,
}: {
  directory: Directory;
  busy: boolean;
  call: CallFn;
}) {
  const t = useT();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const groups = groupPermissions(directory.permissions);

  return (
    <>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          <Plus className="size-4" /> {t("users.roles.add")}
        </button>
      </div>

      <div className="space-y-4">
        {directory.roles.map((role) => (
          <RoleCard key={role.id} role={role} groups={groups} busy={busy} call={call} />
        ))}
      </div>

      <Modal open={creating} title={t("users.roles.add")} onClose={() => setCreating(false)}>
        <div className="space-y-3">
          <p className="text-xs text-subtle">
            {t("users.roles.intro")}
          </p>
          <label className="block text-sm">
            <span className="text-subtle">{t("users.roles.name")}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-md border border-line bg-canvas px-3 py-1.5 text-sm outline-none focus:border-brand"
            />
          </label>
          <label className="block text-sm">
            <span className="text-subtle">{t("users.roles.description")}</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-md border border-line bg-canvas px-3 py-1.5 text-sm outline-none focus:border-brand"
            />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:text-ink"
            >
              {t("common.actions.cancel")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (await call("/api/roles", "POST", { name, description, permissions: [] })) {
                  setCreating(false);
                  setName("");
                  setDescription("");
                }
              }}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {t("common.actions.add")}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function RoleCard({
  role,
  groups,
  busy,
  call,
}: {
  role: ManagedRole;
  groups: [string, PermissionInfo[]][];
  busy: boolean;
  call: CallFn;
}) {
  const t = useT();
  const [draft, setDraft] = useState<string[]>(role.permissions);
  const dirty =
    draft.length !== role.permissions.length ||
    draft.some((key) => !role.permissions.includes(key as never));

  function toggle(key: string) {
    setDraft((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  return (
    <section className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            {role.name}
            {role.isSystem && (
              <span className="rounded border border-line px-1 text-[10px] font-normal text-subtle">
                {t("users.roles.system")}
              </span>
            )}
          </h3>
          <p className="text-xs text-subtle">
            {t("users.roles.summary", {
              description: role.description || "—",
              users: role.userCount,
              permissions: draft.length,
            })}
          </p>
        </div>
        <div className="flex gap-2">
          {dirty && (
            <>
              <button
                type="button"
                onClick={() => setDraft(role.permissions)}
                className="rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:text-ink"
              >
                {t("users.roles.revert")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void call(`/api/roles/${role.id}`, "PATCH", { permissions: draft })
                }
                className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {t("common.actions.save")}
              </button>
            </>
          )}
          {!role.isSystem && !dirty && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (confirm(t("users.roles.confirmDelete", { name: role.name }))) {
                  void call(`/api/roles/${role.id}`, "DELETE");
                }
              }}
              className="rounded border border-line p-1.5 text-subtle transition-colors hover:text-danger disabled:opacity-50"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {dirty && (
        <p className="border-b border-line bg-warn/5 px-5 py-2 text-xs text-warn">
          {t("users.roles.dirtyNote", { count: role.userCount })}
        </p>
      )}

      <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map(([prefix, permissions]) => (
          <div key={prefix}>
            <p className="mb-1 text-xs font-semibold text-subtle">
              {GROUP_LABELS[prefix] ? t(GROUP_LABELS[prefix]) : prefix}
            </p>
            <ul className="space-y-1">
              {permissions.map((permission) => (
                <li key={permission.key}>
                  <label className="flex items-start gap-2 text-xs" title={permission.description}>
                    <input
                      type="checkbox"
                      checked={draft.includes(permission.key)}
                      onChange={() => toggle(permission.key)}
                      className="mt-0.5 size-3.5 shrink-0 accent-[var(--brand)]"
                    />
                    <span className="font-mono">{permission.key}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function SessionsTab({
  directory,
  busy,
  call,
}: {
  directory: Directory;
  busy: boolean;
  call: CallFn;
}) {
  const t = useT();
  const f = useFormat();
  const timeAgo = useTimeAgo();
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="rtable w-full min-w-[48rem] text-sm">
        <thead className="border-b border-line text-left text-xs text-subtle">
          <tr>
            <th className="px-4 py-2.5 font-medium">{t("users.col.user")}</th>
            <th className="px-4 py-2.5 font-medium">IP</th>
            <th className="px-4 py-2.5 font-medium">{t("users.sessions.browser")}</th>
            <th className="px-4 py-2.5 font-medium">{t("users.sessions.lastSeen")}</th>
            <th className="px-4 py-2.5 font-medium">{t("users.sessions.expires")}</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {directory.sessions.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-subtle">
                {t("users.sessions.empty")}
              </td>
            </tr>
          )}
          {directory.sessions.map((session) => (
            <tr key={session.id}>
              <td data-label="" className="px-4 py-2.5">
                <span className="font-mono">{session.username}</span>
                {session.current && (
                  <span className="ml-2 rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium text-brand">
                    {t("users.sessions.current")}
                  </span>
                )}
              </td>
              <td data-label="IP" className="px-4 py-2.5 font-mono text-xs">{session.ip || "—"}</td>
              <td data-label={t("users.sessions.browser")} className="max-w-xs truncate px-4 py-2.5 text-xs text-subtle" title={session.userAgent}>
                {session.userAgent || "—"}
              </td>
              <td data-label={t("users.sessions.lastSeen")} className="px-4 py-2.5 text-xs text-subtle">{timeAgo(session.lastSeenAt)}</td>
              <td data-label={t("users.sessions.expires")} className="px-4 py-2.5 text-xs text-subtle">
                {f.dateTime(session.expiresAt * 1000)}
              </td>
              <td data-label="" className="px-4 py-2.5 text-right max-md:text-left">
                {!session.current && (
                  <button
                    type="button"
                    title={t("users.sessions.close")}
                    disabled={busy}
                    onClick={() => void call(`/api/sessions/${session.id}`, "DELETE")}
                    className="rounded border border-line p-1.5 text-subtle transition-colors hover:text-danger disabled:opacity-50"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
