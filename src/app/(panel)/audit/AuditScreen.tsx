"use client";

import { useState } from "react";
import { Download, Filter, RotateCw, Search } from "lucide-react";
import type { AuditPage, AuditRecord } from "@/lib/auth/audit";
import { useFormat, useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";

/**
 * M3.1 — denetim kaydı görüntüleyici.
 *
 * Sayfalama offset tabanlı ve sayfa boyutu 100. Audit tablosu zaman sırasında
 * yazılıp neredeyse hiç silinmediği için offset kayması (aynı satırı iki kez
 * görme) burada pratik bir sorun değil; imleç tabanlı sayfalamanın karmaşıklığı
 * gerekmiyor.
 */

const PAGE_SIZE = 100;

const RESULT_LABEL: Record<string, MessageKey> = {
  ok: "audit.result.ok",
  denied: "audit.result.denied",
  error: "audit.result.error",
};

const RESULT_STYLE: Record<string, string> = {
  ok: "bg-ok/10 text-ok",
  denied: "bg-warn/15 text-warn",
  error: "bg-danger/10 text-danger",
};

type Filters = {
  q: string;
  username: string;
  action: string;
  result: string;
  since: string;
  until: string;
};

const EMPTY: Filters = { q: "", username: "", action: "", result: "", since: "", until: "" };

/** Filtreleri sorgu dizesine çevirir — hem tabloyu hem CSV bağlantısını besler. */
function toQuery(filters: Filters, offset: number): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.username) params.set("username", filters.username);
  if (filters.action) params.set("action", filters.action);
  if (filters.result) params.set("result", filters.result);
  if (filters.since) params.set("since", String(Math.floor(new Date(filters.since).getTime() / 1000)));
  if (filters.until) params.set("until", String(Math.floor(new Date(filters.until).getTime() / 1000)));
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(offset));
  return params.toString();
}

export function AuditScreen({ initial }: { initial: AuditPage }) {
  const t = useT();
  const f = useFormat();
  const [page, setPage] = useState(initial);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  async function load(next: Filters, nextOffset: number) {
    setBusy(true);
    try {
      const response = await fetch(`/api/audit?${toQuery(next, nextOffset)}`);
      if (response.ok) {
        setPage((await response.json()) as AuditPage);
        setOffset(nextOffset);
      }
    } finally {
      setBusy(false);
    }
  }

  function apply(patch: Partial<Filters>) {
    const next = { ...filters, ...patch };
    setFilters(next);
    void load(next, 0);
  }

  const selectClass =
    "rounded-md border border-line bg-canvas px-2 py-1.5 text-sm outline-none focus:border-brand";
  const shown = page.records.length;
  const from = shown === 0 ? 0 : offset + 1;

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:min-w-56">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle"
              aria-hidden
            />
            <input
              type="search"
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") apply({});
              }}
              placeholder={t("audit.search")}
              className="w-full rounded-md border border-line bg-canvas py-1.5 pl-9 pr-3 text-sm outline-none focus:border-brand"
            />
          </div>

          <select
            value={filters.username}
            onChange={(e) => apply({ username: e.target.value })}
            className={selectClass}
          >
            <option value="">{t("audit.allUsers")}</option>
            {page.usernames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          <select
            value={filters.action}
            onChange={(e) => apply({ action: e.target.value })}
            className={selectClass}
          >
            <option value="">{t("audit.allActions")}</option>
            {page.actions.map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
          </select>

          <select
            value={filters.result}
            onChange={(e) => apply({ result: e.target.value })}
            className={selectClass}
          >
            <option value="">{t("audit.allResults")}</option>
            <option value="ok">{t("audit.result.ok")}</option>
            <option value="denied">{t("audit.result.denied")}</option>
            <option value="error">{t("audit.result.error")}</option>
          </select>

          <button
            type="button"
            onClick={() => apply({})}
            disabled={busy}
            title={t("common.actions.refresh")}
            className="rounded-md border border-line p-1.5 text-subtle transition-colors hover:text-ink disabled:opacity-50"
          >
            <RotateCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-subtle">
          <Filter className="size-3.5" aria-hidden />
          <label className="flex items-center gap-1">
            {t("audit.since")}
            <input
              type="datetime-local"
              value={filters.since}
              onChange={(e) => apply({ since: e.target.value })}
              className="rounded border border-line bg-canvas px-1.5 py-1 outline-none focus:border-brand"
            />
          </label>
          <label className="flex items-center gap-1">
            {t("audit.until")}
            <input
              type="datetime-local"
              value={filters.until}
              onChange={(e) => apply({ until: e.target.value })}
              className="rounded border border-line bg-canvas px-1.5 py-1 outline-none focus:border-brand"
            />
          </label>
          {(filters.q || filters.username || filters.action || filters.result || filters.since || filters.until) && (
            <button
              type="button"
              onClick={() => {
                setFilters(EMPTY);
                void load(EMPTY, 0);
              }}
              className="text-brand hover:underline"
            >
              {t("audit.clearFilters")}
            </button>
          )}
          <a
            href={`/api/audit?${toQuery(filters, 0)}&limit=500&format=csv`}
            download
            className="ml-auto flex items-center gap-1 text-brand hover:underline"
          >
            <Download className="size-3.5" /> {t("audit.downloadCsv")}
          </a>
        </div>
      </section>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="rtable w-full min-w-[52rem] text-sm">
          <thead className="border-b border-line text-left text-xs text-subtle">
            <tr>
              <th className="px-4 py-2.5 font-medium">{t("audit.col.time")}</th>
              <th className="px-4 py-2.5 font-medium">{t("audit.col.user")}</th>
              <th className="px-4 py-2.5 font-medium">{t("audit.col.action")}</th>
              <th className="px-4 py-2.5 font-medium">{t("audit.col.target")}</th>
              <th className="px-4 py-2.5 font-medium">{t("audit.col.result")}</th>
              <th className="px-4 py-2.5 font-medium">{t("audit.col.detail")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {page.records.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-subtle">
                  {t("audit.empty")}
                </td>
              </tr>
            )}
            {page.records.map((record) => (
              <Row
                key={record.id}
                record={record}
                expanded={expanded === record.id}
                onToggle={() => setExpanded(expanded === record.id ? null : record.id)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-subtle">
        <span>
          {t("audit.range", { total: f.number(page.total), from, to: offset + shown })}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy || offset === 0}
            onClick={() => void load(filters, Math.max(0, offset - PAGE_SIZE))}
            className="rounded-md border border-line px-3 py-1.5 transition-colors hover:border-brand disabled:opacity-40"
          >
            {t("database.previous")}
          </button>
          <button
            type="button"
            disabled={busy || offset + shown >= page.total}
            onClick={() => void load(filters, offset + PAGE_SIZE)}
            className="rounded-md border border-line px-3 py-1.5 transition-colors hover:border-brand disabled:opacity-40"
          >
            {t("database.next")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({
  record,
  expanded,
  onToggle,
}: {
  record: AuditRecord;
  expanded: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const f = useFormat();
  return (
    <tr onClick={onToggle} className="cursor-pointer hover:bg-line/30">
      <td
        data-label={t("audit.col.time")}
        className="whitespace-nowrap px-4 py-2 text-xs tabular-nums text-subtle"
      >
        {f.dateTime(record.ts * 1000)}
      </td>
      <td data-label={t("audit.col.user")} className="px-4 py-2">
        <span className="font-mono text-xs">{record.username || "—"}</span>
        {record.ip && <div className="font-mono text-[11px] text-subtle">{record.ip}</div>}
      </td>
      <td data-label={t("audit.col.action")} className="px-4 py-2 font-mono text-xs">
        {record.action}
      </td>
      <td data-label={t("audit.col.target")} className="px-4 py-2 text-xs text-subtle">
        {record.targetType ? `${record.targetType}:${record.targetId}` : "—"}
      </td>
      <td data-label={t("audit.col.result")} className="px-4 py-2">
        <span
          className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
            RESULT_STYLE[record.result] ?? "bg-line text-subtle"
          }`}
        >
          {RESULT_LABEL[record.result] ? t(RESULT_LABEL[record.result]) : record.result}
        </span>
      </td>
      <td
        data-label={t("audit.col.detail")}
        className={`px-4 py-2 text-xs ${expanded ? "" : "max-w-md truncate"}`}
      >
        {record.detail || "—"}
      </td>
    </tr>
  );
}
