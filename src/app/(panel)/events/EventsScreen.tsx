"use client";

import { useCallback, useEffect, useState } from "react";
import { BellOff, Check, Send } from "lucide-react";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import {
  SEVERITY_LABEL,
  SUPPRESS_LABEL,
  type ChannelStatus,
  type EventRow,
  type Severity,
} from "@/lib/alerts/types";
import { useFormat, useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

const SEVERITY_STYLE: Record<Severity, string> = {
  ok: "bg-ok/15 text-ok",
  info: "bg-brand/15 text-brand",
  warning: "bg-warn/15 text-warn",
  critical: "bg-danger/15 text-danger",
};

const SOURCE_LABEL: Record<string, MessageKey> = {
  monitor: "eventsScreen.source.monitor",
  metric: "eventsScreen.source.metric",
  system: "eventsScreen.source.system",
  docker: "eventsScreen.source.docker",
};

const FILTERS: { value: string; label: MessageKey }[] = [
  { value: "", label: "eventsScreen.filter.all" },
  { value: "critical", label: "eventsScreen.filter.critical" },
  { value: "warning", label: "eventsScreen.filter.warning" },
  { value: "ok", label: "eventsScreen.filter.ok" },
];

const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
};

type Props = {
  initialEvents: EventRow[];
  initialChannels: ChannelStatus[];
  canManage: boolean;
  canTest: boolean;
  refreshSeconds: number;
};

export function EventsScreen({
  initialEvents,
  initialChannels,
  canManage,
  canTest,
  refreshSeconds,
}: Props) {
  const t = useT();
  const f = useFormat();
  const [events, setEvents] = useState(initialEvents);
  const [channels, setChannels] = useState(initialChannels);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async (severity: string, signal?: AbortSignal) => {
    try {
      const response = await fetch(
        `/api/events?limit=200${severity ? `&severity=${severity}` : ""}`,
        { signal, cache: "no-store" },
      );
      if (!response.ok) return;
      const data = (await response.json()) as {
        events: EventRow[];
        channels: ChannelStatus[];
      };
      setEvents(data.events);
      setChannels(data.channels);
    } catch {
      // Ağ hatası: mevcut liste ekranda kalır.
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const immediate = setTimeout(() => void load(filter, controller.signal), 0);
    const timer = setInterval(
      () => void load(filter, controller.signal),
      Math.max(10, refreshSeconds * 2) * 1000,
    );
    return () => {
      controller.abort();
      clearTimeout(immediate);
      clearInterval(timer);
    };
  }, [filter, load, refreshSeconds]);

  async function acknowledge(ids: number[]) {
    setBusy("ack");
    try {
      const response = await fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: JSON.stringify({ ids }),
      });
      const data = (await response.json()) as { events?: EventRow[]; error?: string };
      if (response.ok && data.events) setEvents(data.events);
      else setNotice({ text: data.error ?? t("common.errors.actionFailed"), ok: false });
    } catch {
      setNotice({ text: t("common.errors.network"), ok: false });
    } finally {
      setBusy(null);
    }
  }

  async function testChannel(key: string) {
    setBusy(key);
    setNotice(null);
    try {
      const response = await fetch("/api/notify/test", {
        method: "POST",
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: JSON.stringify({ channel: key }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        channels?: ChannelStatus[];
      };
      if (data.channels) setChannels(data.channels);
      setNotice(
        data.ok
          ? { text: t("eventsScreen.testSent", { key }), ok: true }
          : { text: `${key}: ${data.error ?? t("eventsScreen.testFailed")}`, ok: false },
      );
    } catch {
      setNotice({ text: t("common.errors.network"), ok: false });
    } finally {
      setBusy(null);
    }
  }

  const unacknowledged = events.filter(
    (event) =>
      event.acknowledgedAt === null &&
      (event.severity === "warning" || event.severity === "critical"),
  );

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-line bg-surface">
        <div className="border-b border-line px-5 py-3">
          <h2 className="font-semibold">{t("eventsScreen.channels")}</h2>
          <p className="mt-0.5 text-xs text-subtle">
            {t("eventsScreen.channelsIntro")}
          </p>
        </div>

        <div className="divide-y divide-line">
          {channels.map((channel) => (
            <div
              key={channel.key}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`size-2 shrink-0 rounded-full ${
                      !channel.enabled
                        ? "bg-line"
                        : channel.problem
                          ? "bg-danger"
                          : "bg-ok"
                    }`}
                  />
                  <span className="text-sm font-medium">{channel.label}</span>
                  <span className="text-xs text-subtle">
                    {channel.enabled
                      ? t("eventsScreen.minLevel", { level: t(SEVERITY_LABEL[channel.minLevel]) })
                      : t("eventsScreen.channelOff")}
                  </span>
                </div>
                {channel.enabled && channel.problem && (
                  <p className="mt-0.5 text-xs text-danger">{channel.problem}</p>
                )}
              </div>

              {canTest && (
                <button
                  type="button"
                  onClick={() => void testChannel(channel.key)}
                  disabled={busy !== null || !channel.enabled}
                  className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs transition-colors hover:border-brand hover:text-brand disabled:opacity-40"
                >
                  <Send className="size-3.5" />
                  {busy === channel.key ? t("eventsScreen.sending") : t("eventsScreen.sendTest")}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {notice && (
        <p
          className={`rounded-md border px-4 py-2 text-sm ${
            notice.ok ? "border-ok/40 text-ok" : "border-danger/40 text-danger"
          }`}
        >
          {notice.text}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setFilter(option.value)}
              className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                filter === option.value
                  ? "border-brand bg-brand/10 text-brand"
                  : "border-line text-subtle hover:text-ink"
              }`}
            >
              {t(option.label)}
            </button>
          ))}
        </div>

        {canManage && unacknowledged.length > 0 && (
          <button
            type="button"
            onClick={() => void acknowledge(unacknowledged.map((e) => e.id))}
            disabled={busy !== null}
            className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
          >
            <Check className="size-3.5" />{" "}
            {t("eventsScreen.ackAll", { count: unacknowledged.length })}
          </button>
        )}
      </div>

      {events.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-surface px-5 py-8 text-center text-sm text-subtle">
          {t("eventsScreen.empty")}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <div className="divide-y divide-line">
            {events.map((event) => (
              <div key={event.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${SEVERITY_STYLE[event.severity]}`}
                >
                  {t(SEVERITY_LABEL[event.severity])}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{event.title}</span>
                    <span className="rounded border border-line px-1 text-[10px] text-subtle">
                      {SOURCE_LABEL[event.source] ? t(SOURCE_LABEL[event.source]) : event.source}
                    </span>
                    {event.acknowledgedAt !== null && (
                      <span className="text-[10px] text-subtle">
                        {t("eventsScreen.acked", { user: event.acknowledgedBy ?? "" })}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 whitespace-pre-line text-xs text-subtle">
                    {event.detail}
                  </p>

                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                    {event.notifiedChannels.length > 0 && (
                      <span className="text-ok">
                        {t("eventsScreen.notified", { list: event.notifiedChannels.join(", ") })}
                      </span>
                    )}
                    {event.suppressedReason && (
                      <span className="flex items-center gap-1 text-warn">
                        <BellOff className="size-3" />
                        {t("eventsScreen.suppressed", {
                          reason: SUPPRESS_LABEL[event.suppressedReason]
                            ? t(SUPPRESS_LABEL[event.suppressedReason])
                            : event.suppressedReason,
                        })}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-subtle">{f.dateTime(event.ts * 1000, TIME_FORMAT)}</span>
                  {canManage && event.acknowledgedAt === null && event.severity !== "ok" && (
                    <button
                      type="button"
                      title={t("eventsScreen.ack")}
                      aria-label={t("eventsScreen.ack")}
                      onClick={() => void acknowledge([event.id])}
                      disabled={busy !== null}
                      className="rounded border border-line p-1 text-subtle transition-colors hover:text-ink disabled:opacity-50"
                    >
                      <Check className="size-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
