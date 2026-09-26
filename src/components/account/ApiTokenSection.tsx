"use client";

import { useState } from "react";
import { AlertTriangle, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import { useFormat, useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import { copyText } from "@/lib/client/clipboard";

/**
 * T12 — kendi API anahtarların.
 *
 * Akış TwoFactorSection'ı takip ediyor: değer BİR KEZ gösterilir, kullanıcı
 * "kaydettim" diyene kadar ekranda durur, sonra bir daha üretilemez. Aynı
 * uyarı dili bilerek — ikisi de "kaybedersen yenisini üret" sözleşmesinde.
 */

/** Seçildiğinde görünür uyarı çıkaran izinler — sunucuyu etkileyebilenler. */
const RISKY: Record<string, MessageKey> = {
  "docker.action": "account.tokens.risky.docker.action",
  "host.power": "account.tokens.risky.host.power",
  "host.service": "account.tokens.risky.host.service",
  "users.manage": "account.tokens.risky.users.manage",
  "settings.edit": "account.tokens.risky.settings.edit",
  "db.write": "account.tokens.risky.db.write",
  "files.write": "account.tokens.risky.files.write",
};

type TokenRow = {
  id: number;
  name: string;
  prefix: string;
  username: string;
  permissions: string[];
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
  lastUsedFrom: string;
  revokedAt: number | null;
};

export type ApiTokenPayload = {
  tokens: TokenRow[];
  canSeeAll: boolean;
  activeCount: number;
  maxTokens: number;
  defaultTtlDays: number;
  grantablePermissions: string[];
};

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

const SHORT: Intl.DateTimeFormatOptions = { dateStyle: "short", timeStyle: "short" };

/**
 * İlk veri SUNUCUDAN prop olarak geliyor, effect ile çekilmiyor.
 *
 * TwoFactorSection ile aynı kalıp. Effect'te fetch edilseydi ekran bir kare
 * boş çizilir, sonra kendini yeniden çizerdi — üstelik React 19 bunu
 * "cascading render" olarak işaretliyor. Tazeleme yalnızca bir mutasyondan
 * SONRA gerekiyor ve o da olay işleyicisinde, effect'te değil.
 */
export function ApiTokenSection({ apiEnabled, initial }: { apiEnabled: boolean; initial: ApiTokenPayload }) {
  const t = useT();
  const f = useFormat();
  const formatDate = (seconds: number | null) =>
    seconds === null ? "—" : f.dateTime(seconds * 1000, SHORT);
  const [data, setData] = useState<ApiTokenPayload>(initial);
  const [showAll, setShowAll] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [ttl, setTtl] = useState<number>(initial.defaultTtlDays);
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(all = showAll) {
    const response = await fetch(`/api/tokens${all ? "?all=1" : ""}`);
    if (!response.ok) {
      setError(t("account.tokens.loadFailed"));
      return;
    }
    setData((await response.json()) as ApiTokenPayload);
  }

  async function create() {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/tokens", {
      method: "POST",
      headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
      body: JSON.stringify({ name, permissions: selected, expiresInDays: ttl }),
    });
    const payload = (await response.json()) as Record<string, unknown>;
    setBusy(false);

    if (!response.ok) {
      setError(String(payload.error ?? t("account.tokens.createFailed")));
      return;
    }

    setFresh(String(payload.token));
    setCreating(false);
    setName("");
    setSelected([]);
    await load();
  }

  async function revoke(id: number, label: string) {
    if (!window.confirm(t("account.tokens.confirmRevoke", { name: label }))) {
      return;
    }
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/tokens/${id}`, {
      method: "DELETE",
      headers: { [CSRF_HEADER]: readCsrfToken() },
    });
    setBusy(false);
    if (!response.ok) {
      const payload = (await response.json()) as Record<string, unknown>;
      setError(String(payload.error ?? t("account.tokens.revokeFailed")));
      return;
    }
    await load();
  }

  function toggle(key: string) {
    setSelected((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
    );
  }

  const atLimit = data.activeCount >= data.maxTokens;
  const riskySelected = selected.filter((key) => key in RISKY);

  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <KeyRound className="size-4 text-subtle" aria-hidden />
        {t("account.tokens.title")}
        <span className="text-xs font-normal text-subtle">
          {t("account.tokens.active", { count: data.activeCount, max: data.maxTokens })}
        </span>
      </h2>

      <p className="mt-1 text-xs leading-snug text-subtle">
        {t("account.tokens.intro")}
      </p>

      {!apiEnabled && (
        <p className="mt-3 flex items-start gap-2 rounded-md bg-warn/10 px-3 py-2 text-xs text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {t("account.tokens.apiDisabled")}
          </span>
        </p>
      )}

      {fresh && (
        <div className="mt-4 rounded-md border border-brand/40 bg-brand/5 p-4">
          <p className="text-sm font-medium">{t("account.tokens.newKey")}</p>
          <p className="mt-1 text-xs text-subtle">
            {t("account.tokens.shownOnce")}
          </p>
          <code className="mt-3 block select-all break-all rounded bg-canvas px-2 py-1.5 font-mono text-xs">
            {fresh}
          </code>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void copyText(fresh)}
              className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-sm transition-colors hover:border-brand"
            >
              <Copy className="size-4" /> {t("common.actions.copy")}
            </button>
            <button
              type="button"
              onClick={() => setFresh(null)}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              {t("account.saved")}
            </button>
          </div>
        </div>
      )}

      {creating && (
        <div className="mt-4 space-y-3 rounded-md border border-line p-4">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("account.tokens.namePlaceholder")}
              className="w-full max-w-64 rounded-md border border-line bg-canvas px-3 py-1.5 text-sm outline-none focus:border-brand"
            />
            <label className="flex items-center gap-1.5 text-sm text-subtle">
              {t("account.tokens.lifetime")}
              <input
                type="number"
                min={0}
                value={ttl}
                onChange={(event) => setTtl(Number(event.target.value))}
                className="w-20 rounded-md border border-line bg-canvas px-2 py-1.5 text-sm outline-none focus:border-brand"
              />
              {t("account.tokens.days")}
            </label>
            <span className="text-xs text-subtle">{t("account.tokens.noExpiry")}</span>
          </div>

          <div>
            <p className="text-xs font-medium">{t("account.tokens.permissions")}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {data.grantablePermissions.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggle(key)}
                  className={`rounded-md border px-2 py-1 font-mono text-xs transition-colors ${
                    selected.includes(key)
                      ? "border-brand bg-brand/10 text-ink"
                      : "border-line text-subtle hover:border-brand"
                  }`}
                >
                  {key}
                </button>
              ))}
            </div>
          </div>

          {riskySelected.length > 0 && (
            <div className="rounded-md bg-warn/10 px-3 py-2 text-xs text-warn">
              <p className="flex items-center gap-1.5 font-medium">
                <AlertTriangle className="size-3.5" aria-hidden /> {t("account.tokens.riskyTitle")}
              </p>
              <ul className="mt-1 space-y-0.5">
                {riskySelected.map((key) => (
                  <li key={key}>
                    <code className="font-mono">{key}</code> — {t(RISKY[key])}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void create()}
              disabled={busy || !name || selected.length === 0}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {t("account.tokens.generate")}
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:text-ink"
            >
              {t("common.actions.cancel")}
            </button>
          </div>
        </div>
      )}

      {!creating && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCreating(true)}
            disabled={atLimit}
            title={atLimit ? t("account.tokens.atLimit") : undefined}
            className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Plus className="size-4" /> {t("account.tokens.new")}
          </button>
          {data.canSeeAll && (
            <label className="flex items-center gap-1.5 text-xs text-subtle">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(event) => {
                  setShowAll(event.target.checked);
                  void load(event.target.checked);
                }}
              />
              {t("account.tokens.showAll")}
            </label>
          )}
        </div>
      )}

      {data.tokens.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-subtle">
              <tr>
                <th className="pb-1.5 pr-3 font-medium">{t("users.roles.name")}</th>
                <th className="pb-1.5 pr-3 font-medium">{t("account.tokens.col.prefix")}</th>
                {showAll && <th className="pb-1.5 pr-3 font-medium">{t("account.tokens.col.owner")}</th>}
                <th className="pb-1.5 pr-3 font-medium">{t("account.tokens.permissions")}</th>
                <th className="pb-1.5 pr-3 font-medium">{t("account.tokens.col.lastUsed")}</th>
                <th className="pb-1.5 pr-3 font-medium">{t("account.tokens.col.expires")}</th>
                <th className="pb-1.5" />
              </tr>
            </thead>
            <tbody>
              {data.tokens.map((token) => (
                <tr
                  key={token.id}
                  className={`border-t border-line ${token.revokedAt !== null ? "opacity-45" : ""}`}
                >
                  <td className="py-1.5 pr-3">{token.name}</td>
                  <td className="py-1.5 pr-3 font-mono">{token.prefix}</td>
                  {showAll && <td className="py-1.5 pr-3">{token.username}</td>}
                  <td className="py-1.5 pr-3 font-mono text-[11px]">
                    {token.permissions.join(", ")}
                  </td>
                  <td className="py-1.5 pr-3">
                    {formatDate(token.lastUsedAt)}
                    {token.lastUsedFrom && (
                      <span className="ml-1 text-subtle">({token.lastUsedFrom})</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3">
                    {token.revokedAt !== null ? t("account.tokens.revoked") : formatDate(token.expiresAt)}
                  </td>
                  <td className="py-1.5 text-right">
                    {token.revokedAt === null && (
                      <button
                        type="button"
                        onClick={() => void revoke(token.id, token.name)}
                        disabled={busy}
                        aria-label={t("account.tokens.revokeAria", { name: token.name })}
                        className="text-subtle transition-colors hover:text-danger disabled:opacity-50"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.tokens.length === 0 && !creating && (
        <p className="mt-4 text-xs text-subtle">{t("account.tokens.empty")}</p>
      )}

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </section>
  );
}
