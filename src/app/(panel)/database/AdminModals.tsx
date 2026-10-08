"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import type { DbUser, InventoryInstance } from "@/lib/dbadmin/types";
import { useT } from "@/lib/i18n/client";
import { call, generatePassword } from "./api";

/**
 * Envanter sunucusu için yönetim pencereleri: kimlik, yeni veritabanı,
 * kullanıcılar ve yetkiler. Tümü `/api/database/admin` (ve kimlik için
 * `/api/database`) üzerinden; hiçbiri SQL editörünü kullanmıyor.
 */

const inputClass =
  "mt-1 w-full rounded-md border border-line bg-canvas px-3 py-1.5 text-sm outline-none focus:border-brand";
const buttonClass =
  "rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand disabled:opacity-50";
const primaryClass =
  "rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50";

function ErrorLine({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="whitespace-pre-wrap rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">
      {text}
    </p>
  );
}

/* --- Kimlik --- */

export function CredentialsModal({
  instance,
  onClose,
  onSaved,
}: {
  instance: InventoryInstance | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(reset: boolean) {
    if (!instance) return;
    setBusy(true);
    setError(null);
    try {
      const { response, payload } = await call("/api/database", "POST", {
        action: "credentials",
        id: instance.connectionId,
        username: reset ? "" : username,
        password: reset ? "" : password,
      });
      if (!response.ok) {
        setError(String(payload.error ?? t("common.errors.actionFailed")));
        return;
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={instance !== null} title={t("database.inventory.credentials")} onClose={onClose}>
      {instance && (
        <div className="space-y-3">
          <p className="text-xs text-subtle">
            {instance.transport === "docker"
              ? t("database.credentials.dockerHelp")
              : t("database.credentials.nativeHelp")}
          </p>
          <p className="text-xs">
            {t("database.credentials.current")}{" "}
            <strong>
              {instance.credentials === "manual"
                ? t("database.credentials.manual")
                : instance.credentials === "auto"
                  ? t("database.credentials.auto")
                  : t("database.credentials.missing")}
            </strong>
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {instance.engine !== "redis" && (
              <label className="block text-sm">
                <span className="text-subtle">{t("database.modal.user")}</span>
                <input value={username} onChange={(e) => setUsername(e.target.value)} className={inputClass} />
              </label>
            )}
            <label className="block text-sm">
              <span className="text-subtle">{t("database.modal.password")}</span>
              <input
                type="password"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </label>
          </div>
          <ErrorLine text={error} />
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            {instance.credentials === "manual" && (
              <button type="button" disabled={busy} onClick={() => void save(true)} className={buttonClass}>
                {t("database.credentials.reset")}
              </button>
            )}
            <button type="button" onClick={onClose} className={buttonClass}>
              {t("common.actions.cancel")}
            </button>
            <button
              type="button"
              disabled={busy || (instance.engine !== "redis" && !username.trim())}
              onClick={() => void save(false)}
              className={primaryClass}
            >
              {t("common.actions.save")}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* --- Yeni veritabanı --- */

export function CreateDbModal({
  instance,
  onClose,
  onCreated,
}: {
  instance: InventoryInstance | null;
  onClose: () => void;
  onCreated: (database: string) => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [withUser, setWithUser] = useState(true);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState(() => generatePassword());
  const [host, setHost] = useState("%");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mysql = instance?.engine === "mysql";

  async function submit() {
    if (!instance) return;
    setBusy(true);
    setError(null);
    try {
      const { response, payload } = await call("/api/database/admin", "POST", {
        connectionId: instance.connectionId,
        action: "create-db",
        database: name.trim(),
        ...(withUser ? { user: (user || name).trim(), password, host } : {}),
      });
      if (!response.ok) {
        setError(String(payload.error ?? t("common.errors.actionFailed")));
        return;
      }
      onCreated(name.trim());
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={instance !== null} title={t("database.createDb.title")} onClose={onClose}>
      {instance && (
        <div className="space-y-3">
          <p className="text-xs text-subtle">{t("database.createDb.intro", { server: instance.label })}</p>
          <label className="block text-sm">
            <span className="text-subtle">{t("database.createDb.name")}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="uygulama_db"
              className={`${inputClass} font-mono`}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={withUser}
              onChange={(e) => setWithUser(e.target.checked)}
              className="size-4 accent-[var(--brand)]"
            />
            {t("database.createDb.withUser")}
          </label>
          {withUser && (
            <div className="space-y-3 rounded-md border border-line p-3">
              <div className={`grid gap-3 ${mysql ? "sm:grid-cols-2" : ""}`}>
                <label className="block text-sm">
                  <span className="text-subtle">{t("database.modal.user")}</span>
                  <input
                    value={user}
                    onChange={(e) => setUser(e.target.value)}
                    placeholder={name || "uygulama"}
                    className={`${inputClass} font-mono`}
                  />
                </label>
                {mysql && (
                  <label className="block text-sm">
                    <span className="text-subtle">{t("database.users.host")}</span>
                    <input value={host} onChange={(e) => setHost(e.target.value)} className={`${inputClass} font-mono`} />
                  </label>
                )}
              </div>
              <label className="block text-sm">
                <span className="text-subtle">{t("database.modal.password")}</span>
                <span className="mt-1 flex gap-2">
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="off"
                    className={`${inputClass} mt-0 font-mono`}
                  />
                  <button
                    type="button"
                    onClick={() => setPassword(generatePassword())}
                    title={t("database.createDb.regenerate")}
                    className="rounded-md border border-line px-2 text-subtle hover:text-ink"
                  >
                    <RefreshCw className="size-3.5" />
                  </button>
                </span>
                <span className="mt-1 block text-xs text-subtle">{t("database.createDb.passwordHelp")}</span>
              </label>
            </div>
          )}
          <ErrorLine text={error} />
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className={buttonClass}>
              {t("common.actions.cancel")}
            </button>
            <button type="button" disabled={busy || !name.trim()} onClick={() => void submit()} className={primaryClass}>
              {t("database.createDb.submit")}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* --- Kullanıcılar ve yetkiler --- */

export function UsersModal({ instance, onClose }: { instance: InventoryInstance | null; onClose: () => void }) {
  const t = useT();
  const [users, setUsers] = useState<DbUser[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ user: "", password: generatePassword(), host: "%" });
  const [grantForm, setGrantForm] = useState({ account: "", database: "", level: "all" as "all" | "read" });
  const mysql = instance?.engine === "mysql";
  const databases = (instance?.databases ?? []).filter((entry) => !entry.system);

  const admin = useCallback(
    async (body: Record<string, unknown>) => {
      if (!instance) return null;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const { response, payload } = await call("/api/database/admin", "POST", {
          connectionId: instance.connectionId,
          ...body,
        });
        if (!response.ok) {
          setError(String(payload.error ?? t("common.errors.actionFailed")));
          return null;
        }
        return payload;
      } finally {
        setBusy(false);
      }
    },
    [instance, t],
  );

  const load = useCallback(async () => {
    const payload = await admin({ action: "users" });
    if (payload) setUsers((payload.users as DbUser[]) ?? []);
  }, [admin]);

  useEffect(() => {
    if (!instance) return;
    void (async () => {
      await load();
    })();
  }, [instance, load]);

  const accountOf = (entry: DbUser) => (mysql ? `${entry.name}@${entry.host}` : entry.name);
  const split = (account: string) => {
    const at = account.lastIndexOf("@");
    return mysql && at > 0 ? { user: account.slice(0, at), host: account.slice(at + 1) } : { user: account, host: "%" };
  };

  async function act(body: Record<string, unknown>, message: string) {
    if (await admin(body)) {
      setNotice(message);
      await load();
    }
  }

  return (
    <Modal
      open={instance !== null}
      title={instance ? `${t("database.users.title")} — ${instance.label}` : ""}
      onClose={onClose}
      wide
    >
      {instance && (
        <div className="space-y-4">
          <ErrorLine text={error} />
          {notice && <p className="rounded-md bg-ok/10 px-3 py-2 text-xs text-ok">{notice}</p>}

          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full text-xs">
              <thead className="border-b border-line text-left text-subtle">
                <tr>
                  <th className="px-3 py-2 font-medium">{t("database.modal.user")}</th>
                  <th className="px-3 py-2 font-medium">{t("database.users.grants")}</th>
                  <th className="w-20 px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {users === null && (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-subtle">
                      {t("database.reading")}
                    </td>
                  </tr>
                )}
                {(users ?? []).map((entry) => (
                  <tr key={accountOf(entry)} className="align-top">
                    <td className="px-3 py-2 font-mono">
                      {accountOf(entry)}
                      {entry.superuser && (
                        <span className="ml-2 inline-flex items-center gap-0.5 rounded bg-warn/15 px-1.5 py-0.5 font-sans text-[10px] text-warn">
                          <ShieldCheck className="size-3" /> {t("database.users.superuser")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {entry.grants.length === 0 ? (
                        <span className="text-subtle">—</span>
                      ) : (
                        <ul className="space-y-0.5 font-mono text-[11px]">
                          {entry.grants.map((line) => (
                            <li key={line} className="break-all">
                              {line}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          disabled={busy}
                          title={t("database.users.setPassword")}
                          onClick={() => {
                            const next = prompt(t("database.users.newPassword", { user: accountOf(entry) }));
                            if (next) {
                              void act(
                                { action: "set-password", user: entry.name, host: entry.host || "%", password: next },
                                t("database.users.passwordChanged"),
                              );
                            }
                          }}
                          className="rounded p-1 text-subtle hover:text-ink disabled:opacity-40"
                        >
                          <KeyRound className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          title={t("database.users.drop")}
                          onClick={() => {
                            if (confirm(t("database.users.confirmDrop", { user: accountOf(entry) }))) {
                              void act(
                                { action: "drop-user", user: entry.name, host: entry.host || "%" },
                                t("database.users.dropped"),
                              );
                            }
                          }}
                          className="rounded p-1 text-subtle hover:text-danger disabled:opacity-40"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <section className="space-y-2 rounded-md border border-line p-3">
              <h3 className="text-xs font-semibold text-subtle">{t("database.users.create")}</h3>
              <div className={`grid gap-2 ${mysql ? "grid-cols-[1fr_6rem]" : ""}`}>
                <input
                  value={form.user}
                  onChange={(e) => setForm({ ...form, user: e.target.value })}
                  placeholder={t("database.modal.user")}
                  className={`${inputClass} mt-0 font-mono`}
                />
                {mysql && (
                  <input
                    value={form.host}
                    onChange={(e) => setForm({ ...form, host: e.target.value })}
                    title={t("database.users.host")}
                    className={`${inputClass} mt-0 font-mono`}
                  />
                )}
              </div>
              <span className="flex gap-2">
                <input
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  autoComplete="off"
                  className={`${inputClass} mt-0 font-mono`}
                />
                <button
                  type="button"
                  onClick={() => setForm({ ...form, password: generatePassword() })}
                  title={t("database.createDb.regenerate")}
                  className="rounded-md border border-line px-2 text-subtle hover:text-ink"
                >
                  <RefreshCw className="size-3.5" />
                </button>
              </span>
              <button
                type="button"
                disabled={busy || !form.user.trim()}
                onClick={() =>
                  void act(
                    { action: "create-user", user: form.user.trim(), host: form.host, password: form.password },
                    t("database.users.created"),
                  )
                }
                className={primaryClass}
              >
                {t("database.users.createSubmit")}
              </button>
            </section>

            <section className="space-y-2 rounded-md border border-line p-3">
              <h3 className="text-xs font-semibold text-subtle">{t("database.users.grantTitle")}</h3>
              <select
                value={grantForm.account}
                onChange={(e) => setGrantForm({ ...grantForm, account: e.target.value })}
                className={`${inputClass} mt-0`}
              >
                <option value="">{t("database.users.pickUser")}</option>
                {(users ?? [])
                  .filter((entry) => !entry.superuser)
                  .map((entry) => (
                    <option key={accountOf(entry)} value={accountOf(entry)}>
                      {accountOf(entry)}
                    </option>
                  ))}
              </select>
              <select
                value={grantForm.database}
                onChange={(e) => setGrantForm({ ...grantForm, database: e.target.value })}
                className={`${inputClass} mt-0`}
              >
                <option value="">{t("database.users.pickDatabase")}</option>
                {databases.map((entry) => (
                  <option key={entry.name} value={entry.name}>
                    {entry.name}
                  </option>
                ))}
              </select>
              <select
                value={grantForm.level}
                onChange={(e) => setGrantForm({ ...grantForm, level: e.target.value as "all" | "read" })}
                className={`${inputClass} mt-0`}
              >
                <option value="all">{t("database.users.levelAll")}</option>
                <option value="read">{t("database.users.levelRead")}</option>
              </select>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || !grantForm.account || !grantForm.database}
                  onClick={() =>
                    void act(
                      { action: "grant", ...split(grantForm.account), database: grantForm.database, level: grantForm.level },
                      t("database.users.granted"),
                    )
                  }
                  className={primaryClass}
                >
                  {t("database.users.grant")}
                </button>
                <button
                  type="button"
                  disabled={busy || !grantForm.account || !grantForm.database}
                  onClick={() =>
                    void act(
                      { action: "revoke", ...split(grantForm.account), database: grantForm.database },
                      t("database.users.revoked"),
                    )
                  }
                  className={buttonClass}
                >
                  {t("database.users.revoke")}
                </button>
              </div>
            </section>
          </div>
        </div>
      )}
    </Modal>
  );
}
