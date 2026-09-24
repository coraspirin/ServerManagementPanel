"use client";

import { useCallback, useState } from "react";
import {
  AlertTriangle,
  Bell,
  Container,
  Download,
  Plus,
  RotateCw,
  ScrollText,
  Search,
  Server,
  Trash2,
} from "lucide-react";
import { Modal } from "@/components/Modal";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import type {
  LogLevel,
  LogPattern,
  LogRecord,
  LogSearchResult,
  LogSourceInfo,
} from "@/lib/logs/types";
import { useFormat, useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import { withHostQuery } from "@/lib/client/host";

/**
 * M3.3 — merkezi log arama.
 *
 * Canlı akış (M1.7) Docker ekranında kalıyor; burası GEÇMİŞ. İki ekranın işi
 * farklı: biri "şu anda ne oluyor", diğeri "dün gece 03:00'te ne oldu".
 */

type Payload = LogSearchResult & { patterns: LogPattern[] };

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

const LEVEL_STYLE: Record<LogLevel, string> = {
  debug: "text-subtle",
  info: "text-ink",
  warning: "text-warn",
  error: "text-danger",
};

const LEVEL_CHIP: Record<LogLevel, string> = {
  debug: "bg-line text-subtle",
  info: "bg-brand/10 text-brand",
  warning: "bg-warn/15 text-warn",
  error: "bg-danger/15 text-danger",
};

const ALL_LEVELS: LogLevel[] = ["error", "warning", "info", "debug"];

const RANGES: { label: MessageKey; seconds: number }[] = [
  { label: "logsScreen.range.1h", seconds: 3600 },
  { label: "logsScreen.range.24h", seconds: 86400 },
  { label: "logsScreen.range.7d", seconds: 7 * 86400 },
  { label: "logsScreen.range.all", seconds: 0 },
];

const SEVERITY_LABEL: Record<LogPattern["severity"], MessageKey> = {
  info: "logsScreen.severity.info",
  warning: "logsScreen.severity.warning",
  critical: "logsScreen.severity.critical",
};

const PAGE_SIZE = 200;

type Filters = {
  q: string;
  sources: string[];
  levels: LogLevel[];
  rangeSeconds: number;
};

function toQuery(filters: Filters, offset: number): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.sources.length > 0) params.set("sources", filters.sources.join(","));
  if (filters.levels.length > 0) params.set("levels", filters.levels.join(","));
  if (filters.rangeSeconds > 0) {
    params.set("since", String(Math.floor(Date.now() / 1000) - filters.rangeSeconds));
  }
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(offset));
  return params.toString();
}

export function LogsScreen({
  initial,
  canManagePatterns,
}: {
  initial: Payload;
  canManagePatterns: boolean;
}) {
  const t = useT();
  const f = useFormat();
  const [data, setData] = useState(initial);
  const [filters, setFilters] = useState<Filters>({
    q: "",
    sources: [],
    levels: [],
    rangeSeconds: 86400,
  });
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showPatterns, setShowPatterns] = useState(false);

  const load = useCallback(async (next: Filters, nextOffset: number) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/logs?${toQuery(next, nextOffset)}`, {
        cache: "no-store",
      });
      if (response.ok) {
        setData((await response.json()) as Payload);
        setOffset(nextOffset);
      }
    } catch {
      // Ağ hatası: ekrandaki sonuç yerinde kalır.
    } finally {
      setBusy(false);
    }
  }, []);

  function apply(patch: Partial<Filters>) {
    const next = { ...filters, ...patch };
    setFilters(next);
    void load(next, 0);
  }

  async function collectNow() {
    setBusy(true);
    setNotice(t("logsScreen.collecting"));
    try {
      const response = await fetch("/api/logs", {
        method: "POST",
        headers: { [CSRF_HEADER]: readCsrfToken() },
      });
      const payload = (await response.json()) as Payload & {
        outcome?: { collected: number; sources: number; skipped: string[]; errors: string[] };
      };
      if (!response.ok) {
        setNotice(t("logsScreen.collectFailed"));
        return;
      }
      const outcome = payload.outcome;
      setNotice(
        outcome
          ? t("logsScreen.collected", { count: outcome.collected, sources: outcome.sources }) +
              (outcome.skipped.length > 0
                ? t("logsScreen.skipped", { list: outcome.skipped.join("; ") })
                : "") +
              (outcome.errors.length > 0
                ? t("logsScreen.errors", { list: outcome.errors.join("; ") })
                : "")
          : t("logsScreen.done"),
      );
      await load(filters, 0);
    } catch {
      setNotice(t("common.errors.network"));
    } finally {
      setBusy(false);
    }
  }

  function toggleSource(source: string) {
    apply({
      sources: filters.sources.includes(source)
        ? filters.sources.filter((entry) => entry !== source)
        : [...filters.sources, source],
    });
  }

  function toggleLevel(level: LogLevel) {
    apply({
      levels: filters.levels.includes(level)
        ? filters.levels.filter((entry) => entry !== level)
        : [...filters.levels, level],
    });
  }

  const activePatterns = data.patterns.filter((pattern) => pattern.enabled).length;

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
              placeholder={t("logsScreen.search")}
              className="w-full rounded-md border border-line bg-canvas py-1.5 pl-9 pr-3 text-sm outline-none focus:border-brand"
            />
          </div>

          <div className="flex rounded-md border border-line">
            {RANGES.map((entry) => (
              <button
                key={entry.label}
                type="button"
                onClick={() => apply({ rangeSeconds: entry.seconds })}
                className={`px-2.5 py-1 text-sm transition-colors first:rounded-l-md last:rounded-r-md ${
                  filters.rangeSeconds === entry.seconds
                    ? "bg-brand/10 font-medium text-brand"
                    : "text-subtle hover:text-ink"
                }`}
              >
                {t(entry.label)}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void collectNow()}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand disabled:opacity-50"
          >
            <RotateCw className={`size-4 ${busy ? "animate-spin" : ""}`} />{" "}
            {t("logsScreen.collectNow")}
          </button>

          <button
            type="button"
            onClick={() => setShowPatterns(true)}
            className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand"
          >
            <Bell className="size-4" /> {t("logsScreen.rules")}
            <span className="text-xs text-subtle">{activePatterns}</span>
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {ALL_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => toggleLevel(level)}
              className={`rounded px-2 py-0.5 text-xs font-medium transition-opacity ${
                LEVEL_CHIP[level]
              } ${filters.levels.length === 0 || filters.levels.includes(level) ? "" : "opacity-30"}`}
            >
              {level}
            </button>
          ))}

          <span className="mx-1 h-4 w-px bg-line" aria-hidden />

          {data.sources.map((source) => (
            <SourceChip
              key={source.source}
              source={source}
              active={filters.sources.length === 0 || filters.sources.includes(source.source)}
              onClick={() => toggleSource(source.source)}
            />
          ))}

          <a
            href={withHostQuery(`/api/logs?${toQuery(filters, 0)}&format=txt`)}
            download
            className="ml-auto flex items-center gap-1 text-xs text-brand hover:underline"
          >
            <Download className="size-3.5" /> {t("logsScreen.download")}
          </a>
        </div>

        {notice && <p className="mt-2 text-xs text-subtle">{notice}</p>}
      </section>

      {data.totalLines === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-surface px-5 py-12 text-center">
          <ScrollText className="mx-auto size-8 text-subtle" aria-hidden />
          <p className="mt-3 text-sm">{t("logsScreen.emptyTitle")}</p>
          <p className="mt-1 text-xs text-subtle">
            {t("logsScreen.emptyHelp")}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            <ul className="divide-y divide-line font-mono text-xs">
              {data.records.length === 0 && (
                <li className="px-4 py-10 text-center font-sans text-sm text-subtle">
                  {t("logsScreen.noMatch")}
                </li>
              )}
              {data.records.map((record) => (
                <Line key={record.id} record={record} />
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-subtle">
            <span>
              {t("logsScreen.summary", {
                matches: f.number(data.total),
                lines: f.number(data.totalLines),
              })}
              {data.oldest !== null && t("logsScreen.oldest", { date: f.date(data.oldest * 1000) })}
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
                disabled={busy || offset + data.records.length >= data.total}
                onClick={() => void load(filters, offset + PAGE_SIZE)}
                className="rounded-md border border-line px-3 py-1.5 transition-colors hover:border-brand disabled:opacity-40"
              >
                {t("database.next")}
              </button>
            </div>
          </div>
        </>
      )}

      <PatternsModal
        open={showPatterns}
        patterns={data.patterns}
        sources={data.sources.map((source) => source.source)}
        canManage={canManagePatterns}
        onClose={() => setShowPatterns(false)}
        onChanged={(patterns) => setData({ ...data, patterns })}
      />
    </div>
  );
}

function SourceChip({
  source,
  active,
  onClick,
}: {
  source: LogSourceInfo;
  active: boolean;
  onClick: () => void;
}) {
  const t = useT();
  const f = useFormat();
  const Icon = source.kind === "journald" ? Server : Container;

  return (
    <button
      type="button"
      onClick={onClick}
      title={
        source.lastError
          ? t("logsScreen.lastError", { error: source.lastError })
          : t("logsScreen.lines", { count: f.number(source.lines) })
      }
      className={`flex items-center gap-1 rounded border border-line px-2 py-0.5 text-xs transition-opacity ${
        active ? "" : "opacity-30"
      }`}
    >
      <Icon className="size-3" aria-hidden />
      {source.source}
      {source.lastError ? (
        <AlertTriangle className="size-3 text-warn" aria-hidden />
      ) : (
        <span className="text-subtle">{source.lines}</span>
      )}
    </button>
  );
}

function Line({ record }: { record: LogRecord }) {
  const f = useFormat();
  return (
    <li className="flex flex-col gap-0.5 px-3 py-1 hover:bg-line/30 md:flex-row md:gap-3">
      {/*
        Telefonda zaman ve kaynak üst satırda yan yana, mesaj altlarında:
        w-36 + w-40 sabit sütunlar 360px'lik bir ekranda mesaja yer bırakmıyordu.
        `md:contents` sarmalayıcıyı md üstünde düzenden düşürüyor, böylece
        masaüstündeki tek satırlık hizalama olduğu gibi kalıyor.
      */}
      <span className="flex min-w-0 gap-3 md:contents">
        <span className="shrink-0 tabular-nums text-subtle md:w-36">
          {f.dateTime(record.ts * 1000, {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </span>
        <span className="min-w-0 truncate text-subtle md:w-40 md:shrink-0" title={record.source}>
          {record.source}
        </span>
      </span>
      <span className={`min-w-0 flex-1 whitespace-pre-wrap break-all ${LEVEL_STYLE[record.level]}`}>
        {record.message}
      </span>
    </li>
  );
}

const EMPTY_PATTERN = {
  id: 0,
  name: "",
  pattern: "",
  isRegex: true,
  sourceFilter: "",
  severity: "warning" as const,
  enabled: true,
  cooldownMinutes: 30,
};

function PatternsModal({
  open,
  patterns,
  sources,
  canManage,
  onClose,
  onChanged,
}: {
  open: boolean;
  patterns: LogPattern[];
  sources: string[];
  canManage: boolean;
  onClose: () => void;
  onChanged: (patterns: LogPattern[]) => void;
}) {
  const t = useT();
  const f = useFormat();
  const [draft, setDraft] = useState<typeof EMPTY_PATTERN | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(method: string, body?: unknown, query = "") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/logs/patterns${query}`, {
        method,
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = (await response.json()) as { error?: string; patterns?: LogPattern[] };
      if (!response.ok) {
        setError(data.error ?? t("common.errors.actionFailed"));
        return false;
      }
      if (data.patterns) onChanged(data.patterns);
      return true;
    } catch {
      setError(t("common.errors.network"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "mt-1 w-full rounded-md border border-line bg-canvas px-3 py-1.5 text-sm outline-none focus:border-brand";

  return (
    <Modal open={open} title={t("logsScreen.rulesTitle")} onClose={onClose} wide>
      <p className="text-xs leading-snug text-subtle">
        {t("logsScreen.rulesIntro")}
      </p>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <ul className="mt-4 divide-y divide-line rounded-md border border-line">
        {patterns.map((pattern) => (
          <li key={pattern.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
            <input
              type="checkbox"
              checked={pattern.enabled}
              disabled={!canManage || busy}
              onChange={(e) =>
                void send("PATCH", { ...pattern, enabled: e.target.checked })
              }
              className="size-4 accent-[var(--brand)]"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {pattern.name}
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    pattern.severity === "critical"
                      ? "bg-danger/15 text-danger"
                      : pattern.severity === "warning"
                        ? "bg-warn/15 text-warn"
                        : "bg-brand/10 text-brand"
                  }`}
                >
                  {t(SEVERITY_LABEL[pattern.severity])}
                </span>
                {pattern.isRegex && (
                  <span className="rounded border border-line px-1 text-[10px] text-subtle">
                    regex
                  </span>
                )}
              </div>
              <code className="block truncate font-mono text-[11px] text-subtle">
                {pattern.pattern}
              </code>
              <span className="text-[11px] text-subtle">
                {t("logsScreen.ruleMeta", {
                  source: pattern.sourceFilter || t("logsScreen.allSources"),
                  cooldown: pattern.cooldownMinutes,
                  hits: pattern.hitCount,
                })}
                {pattern.lastHitAt &&
                  t("logsScreen.lastHit", { when: f.dateTime(pattern.lastHitAt * 1000) })}
              </span>
            </div>
            {canManage && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (confirm(t("logsScreen.confirmDeleteRule", { name: pattern.name }))) {
                    void send("DELETE", undefined, `?id=${pattern.id}`);
                  }
                }}
                className="rounded border border-line p-1.5 text-subtle transition-colors hover:text-danger disabled:opacity-50"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>

      {canManage &&
        (draft ? (
          <div className="mt-4 space-y-3 rounded-md border border-brand/40 bg-brand/5 p-3">
            <label className="block text-sm">
              <span className="text-subtle">{t("logsScreen.ruleName")}</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="block text-sm">
              <span className="text-subtle">{t("logsScreen.pattern")}</span>
              <input
                value={draft.pattern}
                onChange={(e) => setDraft({ ...draft, pattern: e.target.value })}
                className={`${inputClass} font-mono`}
                placeholder="Out of memory|oom-kill"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-sm">
                <span className="text-subtle">{t("logsScreen.source")}</span>
                <select
                  value={draft.sourceFilter}
                  onChange={(e) => setDraft({ ...draft, sourceFilter: e.target.value })}
                  className={inputClass}
                >
                  <option value="">{t("logsScreen.range.all")}</option>
                  {sources.map((source) => (
                    <option key={source} value={source}>
                      {source}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-subtle">{t("logsScreen.severityLabel")}</span>
                <select
                  value={draft.severity}
                  onChange={(e) =>
                    setDraft({ ...draft, severity: e.target.value as typeof draft.severity })
                  }
                  className={inputClass}
                >
                  <option value="info">{t("logsScreen.severity.info")}</option>
                  <option value="warning">{t("logsScreen.severity.warning")}</option>
                  <option value="critical">{t("logsScreen.severity.critical")}</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-subtle">{t("logsScreen.cooldown")}</span>
                <input
                  type="number"
                  min={0}
                  max={1440}
                  value={draft.cooldownMinutes}
                  onChange={(e) =>
                    setDraft({ ...draft, cooldownMinutes: Number(e.target.value) })
                  }
                  className={inputClass}
                />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.isRegex}
                onChange={(e) => setDraft({ ...draft, isRegex: e.target.checked })}
                className="size-4 accent-[var(--brand)]"
              />
              {t("logsScreen.isRegex")}
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:text-ink"
              >
                {t("common.actions.cancel")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  if (await send("POST", draft)) setDraft(null);
                }}
                className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {t("common.actions.add")}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setDraft({ ...EMPTY_PATTERN })}
            className="mt-4 flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand"
          >
            <Plus className="size-4" /> {t("logsScreen.addRule")}
          </button>
        ))}
    </Modal>
  );
}
