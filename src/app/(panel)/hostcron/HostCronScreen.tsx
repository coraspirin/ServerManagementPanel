"use client";

import { useState } from "react";
import { CalendarClock, ListChecks, Lock, Plus, RotateCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { Modal } from "@/components/Modal";
import { CronEditor } from "@/components/settings/CronEditor";
import { HostUserSelect } from "@/components/settings/HostUserSelect";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import { describeCron } from "@/lib/cron/friendly";
import type { CronEntry, CronState } from "@/lib/hostcron";
import { useDict, useT } from "@/lib/i18n/client";
import { Rich } from "@/lib/i18n/rich";

/**
 * M3.9 — host zamanlanmış görevleri.
 *
 * En üstteki uyarı ekranın en önemli parçası: buradaki görevler HOST'un
 * cron'u, panelin kendi işleri değil. Panel silinse bile çalışmaya devam
 * ederler ve panel çoğunu yalnızca OKUYABİLİR.
 */

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

const EMPTY = {
  name: "",
  schedule: "0 3 * * *",
  user: "root",
  command: "",
  comment: "",
  enabled: true,
};

export function HostCronScreen({ initial }: { initial: CronState }) {
  const t = useT();
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<typeof EMPTY | null>(null);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/hostcron", {
        method: "POST",
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as CronState & {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      if (data.entries) setState({ entries: data.entries, error: data.error ?? null });
      if (!response.ok) {
        setError(data.error ?? data.message ?? t("common.errors.actionFailed"));
        return false;
      }
      setNotice(data.message ?? t("docker.installer.ok"));
      return true;
    } catch {
      setError(t("common.errors.network"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    setBusy(true);
    try {
      const response = await fetch("/api/hostcron", { cache: "no-store" });
      setState((await response.json()) as CronState);
    } finally {
      setBusy(false);
    }
  }

  const managed = state.entries.filter((entry) => entry.managed);
  const readOnly = state.entries.filter((entry) => !entry.managed);

  return (
    <div className="space-y-4">
      <p className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-brand/5 px-4 py-2.5 text-xs text-subtle">
        <CalendarClock className="size-4 shrink-0 text-brand" aria-hidden />
        <span>
          <Rich
            text={t("hostcron.intro")}
            values={{
              strong: <strong>{t("hostcron.introStrong")}</strong>,
              jobs: (
                <Link
                  href="/jobs"
                  className="inline-flex items-center gap-1 text-brand hover:underline"
                >
                  <ListChecks className="size-3.5" /> {t("hostcron.panelJobs")}
                </Link>
              ),
            }}
          />
        </span>
      </p>

      {error && (
        <p role="alert" className="rounded-lg bg-danger/10 px-4 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}
      {notice && <p className="rounded-lg bg-ok/10 px-4 py-2.5 text-sm text-ok">{notice}</p>}
      {state.error && (
        <p className="rounded-lg bg-warn/10 px-4 py-2.5 text-sm text-warn">{state.error}</p>
      )}

      <section className="rounded-lg border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold">
            {t("hostcron.managed")}
            <span className="ml-2 font-normal text-subtle">{managed.length}</span>
          </h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void reload()}
              disabled={busy}
              title={t("common.actions.refresh")}
              className="rounded-md border border-line p-1.5 text-subtle transition-colors hover:text-ink disabled:opacity-50"
            >
              <RotateCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={() => setDraft({ ...EMPTY })}
              className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              <Plus className="size-4" /> {t("hostcron.add")}
            </button>
          </div>
        </div>

        {managed.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-subtle">
            <Rich
              text={t("hostcron.managedEmpty")}
              values={{ path: <code>/etc/cron.d/panel-*</code> }}
            />
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {managed.map((entry) => (
              <Row
                key={entry.id}
                entry={entry}
                busy={busy}
                onEdit={() =>
                  setDraft({
                    name: entry.source.replace("/etc/cron.d/panel-", ""),
                    schedule: entry.schedule,
                    user: entry.user || "root",
                    command: entry.command,
                    comment: entry.comment,
                    enabled: entry.enabled,
                  })
                }
                onDelete={() => {
                  const name = entry.source.replace("/etc/cron.d/panel-", "");
                  if (confirm(t("hostcron.confirmDelete", { name }))) {
                    void send({ action: "delete", name });
                  }
                }}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          <Lock className="size-4 text-subtle" aria-hidden />
          <h2 className="text-sm font-semibold">
            {t("hostcron.system")}
            <span className="ml-2 font-normal text-subtle">
              {t("hostcron.readOnlyCount", { count: readOnly.length })}
            </span>
          </h2>
        </div>
        <p className="border-b border-line px-5 py-2 text-xs text-subtle">
          <Rich text={t("hostcron.systemIntro")} values={{ path: <code>/etc/crontab</code> }} />
        </p>
        {readOnly.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-subtle">{t("hostcron.none")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {readOnly.map((entry) => (
              <Row key={entry.id} entry={entry} busy={busy} />
            ))}
          </ul>
        )}
      </section>

      <CronModal
        key={draft?.name ?? "yeni"}
        draft={draft}
        busy={busy}
        onClose={() => setDraft(null)}
        onSubmit={async (payload) => {
          if (await send(payload)) setDraft(null);
        }}
      />
    </div>
  );
}

function Row({
  entry,
  busy,
  onEdit,
  onDelete,
}: {
  entry: CronEntry;
  busy: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const t = useT();
  const dict = useDict();
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          {/*
            Ham cron ifadesi listeden KALDIRILDI (M3.45): kullanıcı "17 6 * * *"
            biçimini görmek istemiyor ve zaten yanındaki cümle aynı şeyi
            söylüyordu. İfadenin kendisi ipucu metninde duruyor — SSH'tan
            bakacak biri için bir tık uzakta, ekranı kalabalıklaştırmadan.
          */}
          <span className="text-xs font-medium text-brand" title={entry.schedule}>
            {describeCron(entry.schedule, t, dict)}
          </span>
          {!entry.enabled && (
            <span className="rounded border border-line px-1 text-[10px] text-subtle">
              {t("hostcron.disabled")}
            </span>
          )}
        </div>
        <code className="block truncate font-mono text-xs">{entry.command}</code>
        <span className="text-[11px] text-subtle">
          {entry.source}
          {entry.user && t("hostcron.user", { user: entry.user })}
          {entry.comment && ` · ${entry.comment}`}
        </span>
      </div>
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="rounded-md border border-line px-2.5 py-1.5 text-xs transition-colors hover:border-brand"
        >
          {t("common.actions.edit")}
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          disabled={busy}
          onClick={onDelete}
          className="rounded border border-line p-1.5 text-subtle transition-colors hover:text-danger disabled:opacity-50"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </li>
  );
}

function CronModal({
  draft,
  busy,
  onClose,
  onSubmit,
}: {
  draft: typeof EMPTY | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const t = useT();
  const [form, setForm] = useState(draft);
  const inputClass =
    "mt-1 w-full rounded-md border border-line bg-canvas px-3 py-1.5 text-sm outline-none focus:border-brand";

  return (
    <Modal open={draft !== null} title={t("hostcron.modalTitle")} onClose={onClose} wide>
      {form && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-subtle">{t("hostcron.name")}</span>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={t("hostcron.namePlaceholder")}
                className={`${inputClass} font-mono`}
              />
              <span className="mt-1 block text-xs text-subtle">
                <Rich
                  text={t("hostcron.nameHelp")}
                  values={{
                    path: <code>/etc/cron.d/panel-{form.name || t("hostcron.nameFallback")}</code>,
                  }}
                />
              </span>
            </label>
            <label className="block text-sm">
              <span className="text-subtle">{t("hostcron.runAs")}</span>
              <div className="mt-1">
                {/*
                  Host'un /etc/passwd listesinden seçiliyor (M3.45). Elle
                  yazılan bir kullanıcı adı cron tarafından SESSİZCE reddedilir:
                  satır dosyada durur, görev hiç çalışmaz ve panel bunu
                  göremez.
                */}
                <HostUserSelect
                  value={form.user}
                  onChange={(user) => setForm({ ...form, user })}
                />
              </div>
            </label>
          </div>

          <div className="block text-sm">
            <span className="text-subtle">{t("hostcron.schedule")}</span>
            {/*
              Ayarlardaki sıklık seçicisinin aynısı (M3.45). Burada ham cron
              kutusu vardı ve kullanıcı "günde/haftada/ayda/yılda, şu saatte"
              diye düşünürken "17 6 * * *" yazmak zorunda kalıyordu.
              `allowCustom={false}`: özel ifade seçeneği listede yok — yalnızca
              seçiciye sığmayan bir ifade DÜZENLENİRKEN geri geliyor.
            */}
            <div className="mt-1">
              <CronEditor
                value={form.schedule}
                disabled={busy}
                allowCustom={false}
                onCommit={(schedule) => setForm({ ...form, schedule })}
              />
            </div>
          </div>

          <label className="block text-sm">
            <span className="text-subtle">{t("hostcron.command")}</span>
            <input
              value={form.command}
              onChange={(e) => setForm({ ...form, command: e.target.value })}
              placeholder="/usr/bin/find /tmp -mtime +7 -delete"
              className={`${inputClass} font-mono`}
            />
            <span className="mt-1 block text-xs text-subtle">
              {t("hostcron.commandHelp")}
            </span>
          </label>

          <label className="block text-sm">
            <span className="text-subtle">{t("users.roles.description")}</span>
            <input
              value={form.comment}
              onChange={(e) => setForm({ ...form, comment: e.target.value })}
              className={inputClass}
            />
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              className="size-4 accent-[var(--brand)]"
            />
            {t("hostcron.enabled")}
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
              onClick={() => onSubmit({ ...form })}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {t("common.actions.save")}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
