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

function timeAgo(seconds: number | null): string {
  if (!seconds) return "hiç";
  const diff = Math.floor(Date.now() / 1000) - seconds;
  if (diff < 60) return "az önce";
  if (diff < 3600) return `${Math.floor(diff / 60)} dk önce`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} sa önce`;
  return `${Math.floor(diff / 86400)} gün önce`;
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
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], "tr"));
}

const GROUP_LABELS: Record<string, string> = {
  panel: "Panel",
  metrics: "İzleme",
  monitors: "Servis izleme",
  logs: "Loglar",
  docker: "Docker",
  host: "Sunucu",
  apps: "Uygulamalar",
  kiosk: "Kiosk",
  proxy: "Proxy",
  network: "Ağ",
  files: "Dosyalar",
  db: "Veritabanı",
  backup: "Yedekleme",
  security: "Güvenlik",
  cron: "Zamanlanmış görevler",
  repos: "Depolar",
  vault: "Şifre kasası",
  settings: "Ayarlar",
  users: "Kullanıcılar",
  audit: "Denetim",
};

type Tab = "users" | "roles" | "sessions";

export function UsersScreen({
  initial,
  currentUserId,
}: {
  initial: Directory;
  currentUserId: number;
}) {
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
        setError(String(data.error ?? "İşlem başarısız."));
        return false;
      }
      if (data.users) setDirectory(data as unknown as Directory);
      return true;
    } catch {
      setError("Sunucuya ulaşılamadı.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const tabs: { key: Tab; label: string; count: number; icon: typeof Users }[] = [
    { key: "users", label: "Kullanıcılar", count: directory.users.length, icon: Users },
    { key: "roles", label: "Roller", count: directory.roles.length, icon: ShieldCheck },
    { key: "sessions", label: "Oturumlar", count: directory.sessions.length, icon: Monitor },
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
          <UserPlus className="size-4" /> Kullanıcı ekle
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="rtable w-full min-w-[54rem] text-sm">
          <thead className="border-b border-line text-left text-xs text-subtle">
            <tr>
              <th className="px-4 py-2.5 font-medium">Kullanıcı</th>
              <th className="px-4 py-2.5 font-medium">Rol</th>
              <th className="px-4 py-2.5 font-medium">Durum</th>
              <th className="px-4 py-2.5 font-medium">2FA</th>
              <th className="px-4 py-2.5 font-medium">Son giriş</th>
              <th className="px-4 py-2.5 font-medium">Oturum</th>
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
                      {user.id === currentUserId && " · sen"}
                    </div>
                  </td>
                  <td data-label="Rol" className="px-4 py-2.5">
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
                  <td data-label="Durum" className="px-4 py-2.5">
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
                      {user.isActive ? "aktif" : "pasif"}
                    </label>
                    {locked && (
                      <div className="mt-0.5 text-xs text-warn">
                        kilitli ({user.failedAttempts} hatalı)
                      </div>
                    )}
                    {user.mustChangePassword && (
                      <div className="mt-0.5 text-xs text-subtle">parola değiştirmeli</div>
                    )}
                  </td>
                  <td data-label="2FA" className="px-4 py-2.5">
                    {user.totpEnabled ? (
                      <span className="flex items-center gap-1 text-xs text-ok">
                        <ShieldCheck className="size-3.5" aria-hidden /> açık
                        <span className="text-subtle">({user.recoveryLeft} kod)</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-subtle">
                        <ShieldOff className="size-3.5" aria-hidden /> kapalı
                      </span>
                    )}
                  </td>
                  <td data-label="Son giriş" className="px-4 py-2.5 text-xs text-subtle">
                    {timeAgo(user.lastLoginAt)}
                  </td>
                  <td data-label="Oturum" className="px-4 py-2.5 text-xs tabular-nums">{user.activeSessions}</td>
                  <td data-label="" className="px-4 py-2.5">
                    <div className="flex flex-wrap justify-end gap-1 max-md:justify-start">
                      <button
                        type="button"
                        title="Parola sıfırla"
                        onClick={() => setResetting(user)}
                        disabled={busy}
                        className="rounded border border-line p-1.5 text-subtle transition-colors hover:text-ink disabled:opacity-50"
                      >
                        <KeyRound className="size-3.5" />
                      </button>
                      {locked && (
                        <button
                          type="button"
                          title="Kilidi aç"
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
                          title="2FA'yı sıfırla (telefonunu kaybeden kullanıcı için)"
                          onClick={() => {
                            if (
                              confirm(
                                `${user.username} için 2FA sıfırlansın mı? Kullanıcı yalnızca ` +
                                  "parolayla girebilir hâle gelir ve 2FA'yı yeniden kurmalıdır.",
                              )
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
                          title="Sil"
                          onClick={() => {
                            if (confirm(`${user.username} kalıcı olarak silinsin mi?`)) {
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
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState(roles[0]?.id ?? 1);
  const [mustChange, setMustChange] = useState(true);

  const inputClass =
    "mt-1 w-full rounded-md border border-line bg-canvas px-3 py-1.5 text-sm outline-none focus:border-brand";

  return (
    <Modal open={open} title="Kullanıcı ekle" onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="text-subtle">Kullanıcı adı</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={`${inputClass} font-mono`}
          />
        </label>
        <label className="block text-sm">
          <span className="text-subtle">Görünen ad</span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block text-sm">
          <span className="text-subtle">Başlangıç parolası</span>
          <input
            type="text"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${inputClass} font-mono`}
          />
          <span className="mt-1 block text-xs text-subtle">
            En az 10 karakter, en az bir harf ve bir rakam.
          </span>
        </label>
        <label className="block text-sm">
          <span className="text-subtle">Rol</span>
          <select
            value={roleId}
            onChange={(e) => setRoleId(Number(e.target.value))}
            className={inputClass}
          >
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name} — {role.permissions.length} izin
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
          İlk girişte parolasını değiştirsin
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:text-ink"
          >
            Vazgeç
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              onSubmit({ username, displayName, password, roleId, mustChangePassword: mustChange })
            }
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Ekle
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
  const [password, setPassword] = useState("");
  const [mustChange, setMustChange] = useState(true);

  return (
    <Modal
      open={user !== null}
      title={`Parola sıfırla — ${user?.username ?? ""}`}
      onClose={onClose}
    >
      <div className="space-y-3">
        <p className="text-xs text-subtle">
          Yeni parolayı sen belirliyorsun, dolayısıyla sen de biliyorsun. Kullanıcının ilk
          girişte değiştirmesini istemek varsayılan. Sıfırlama, kullanıcının açık tüm
          oturumlarını kapatır.
        </p>
        <label className="block text-sm">
          <span className="text-subtle">Yeni parola</span>
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
          İlk girişte değiştirsin
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:text-ink"
          >
            Vazgeç
          </button>
          <button
            type="button"
            disabled={busy || !password}
            onClick={() => onSubmit(password, mustChange)}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Sıfırla
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
          <Plus className="size-4" /> Rol ekle
        </button>
      </div>

      <div className="space-y-4">
        {directory.roles.map((role) => (
          <RoleCard key={role.id} role={role} groups={groups} busy={busy} call={call} />
        ))}
      </div>

      <Modal open={creating} title="Rol ekle" onClose={() => setCreating(false)}>
        <div className="space-y-3">
          <p className="text-xs text-subtle">
            Yeni rol izinsiz başlar; ekledikten sonra kartından izinleri işaretle.
          </p>
          <label className="block text-sm">
            <span className="text-subtle">Ad</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-md border border-line bg-canvas px-3 py-1.5 text-sm outline-none focus:border-brand"
            />
          </label>
          <label className="block text-sm">
            <span className="text-subtle">Açıklama</span>
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
              Vazgeç
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
              Ekle
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
                sistem rolü
              </span>
            )}
          </h3>
          <p className="text-xs text-subtle">
            {role.description || "—"} · {role.userCount} kullanıcı · {draft.length} izin
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
                Geri al
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void call(`/api/roles/${role.id}`, "PATCH", { permissions: draft })
                }
                className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                Kaydet
              </button>
            </>
          )}
          {!role.isSystem && !dirty && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (confirm(`${role.name} rolü silinsin mi?`)) {
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
          Kaydedince bu rolü kullanan {role.userCount} kullanıcının açık oturumları kapanır —
          izinler oturuma yazılıyor, yeniden giriş gerekir.
        </p>
      )}

      <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map(([prefix, permissions]) => (
          <div key={prefix}>
            <p className="mb-1 text-xs font-semibold text-subtle">
              {GROUP_LABELS[prefix] ?? prefix}
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
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="rtable w-full min-w-[48rem] text-sm">
        <thead className="border-b border-line text-left text-xs text-subtle">
          <tr>
            <th className="px-4 py-2.5 font-medium">Kullanıcı</th>
            <th className="px-4 py-2.5 font-medium">IP</th>
            <th className="px-4 py-2.5 font-medium">Tarayıcı</th>
            <th className="px-4 py-2.5 font-medium">Son etkinlik</th>
            <th className="px-4 py-2.5 font-medium">Biter</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {directory.sessions.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-subtle">
                Açık oturum yok.
              </td>
            </tr>
          )}
          {directory.sessions.map((session) => (
            <tr key={session.id}>
              <td data-label="" className="px-4 py-2.5">
                <span className="font-mono">{session.username}</span>
                {session.current && (
                  <span className="ml-2 rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium text-brand">
                    bu oturum
                  </span>
                )}
              </td>
              <td data-label="IP" className="px-4 py-2.5 font-mono text-xs">{session.ip || "—"}</td>
              <td data-label="Tarayıcı" className="max-w-xs truncate px-4 py-2.5 text-xs text-subtle" title={session.userAgent}>
                {session.userAgent || "—"}
              </td>
              <td data-label="Son etkinlik" className="px-4 py-2.5 text-xs text-subtle">{timeAgo(session.lastSeenAt)}</td>
              <td data-label="Biter" className="px-4 py-2.5 text-xs text-subtle">
                {new Date(session.expiresAt * 1000).toLocaleString("tr-TR")}
              </td>
              <td data-label="" className="px-4 py-2.5 text-right max-md:text-left">
                {!session.current && (
                  <button
                    type="button"
                    title="Oturumu kapat"
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
