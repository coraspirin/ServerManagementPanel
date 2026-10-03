import { Bell } from "lucide-react";
import { SEVERITY_LABEL, type EventRow, type Severity } from "@/lib/alerts/types";
import { formatRelative } from "@/lib/i18n/format";
import { getActiveDictionary, getT } from "@/lib/i18n/server";
import { AckButton } from "./AckButton";
import { WidgetCard, WidgetEmpty } from "./WidgetCard";

const SEVERITY_STYLE: Record<Severity, string> = {
  ok: "bg-ok/15 text-ok",
  info: "bg-brand/15 text-brand",
  warning: "bg-warn/15 text-warn",
  critical: "bg-danger/15 text-danger",
};

/** Son olaylar — seçili sunucunun en yeni kayıtları; tamamı Olaylar ekranında. */
export function RecentEvents({
  events,
  canAck,
  readOnly = false,
}: {
  events: EventRow[];
  canAck: boolean;
  /** Kiosk: bağlantı yok. */
  readOnly?: boolean;
}) {
  const t = getT();
  const dict = getActiveDictionary();
  const unread = events
    .filter((event) => event.acknowledgedAt === null && (event.severity === "warning" || event.severity === "critical"))
    .map((event) => event.id);

  return (
    <WidgetCard
      title={t("dashboard.events.title")}
      icon={Bell}
      href={readOnly ? undefined : "/events"}
      linkLabel={t("dashboard.all")}
      aside={canAck && !readOnly ? <AckButton ids={unread} /> : undefined}
    >
      {events.length === 0 ? (
        <WidgetEmpty>{t("dashboard.events.empty")}</WidgetEmpty>
      ) : (
        <ul className="divide-y divide-line">
          {events.map((event) => (
            <li key={event.id} className="flex items-start gap-2 py-2 first:pt-0 last:pb-0">
              <span
                className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${SEVERITY_STYLE[event.severity]}`}
              >
                {t(SEVERITY_LABEL[event.severity])}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={`truncate text-sm ${event.acknowledgedAt === null ? "font-medium" : "text-subtle"}`}
                  title={event.detail || event.title}
                >
                  {event.title}
                </p>
              </div>
              <time
                dateTime={new Date(event.ts * 1000).toISOString()}
                className="shrink-0 text-xs text-subtle"
              >
                {formatRelative(event.ts * 1000, dict)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}
