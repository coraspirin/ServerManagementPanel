import Link from "next/link";
import { AlertTriangle, CheckCircle2, CircleAlert, Info } from "lucide-react";
import { getT } from "@/lib/i18n/server";

/**
 * Durum şeridi — "her şey yolunda mı?" sorusunun tek satırlık cevabı.
 *
 * Her öğe ilgili ekrana bağlantı. Renk tek başına anlam taşımıyor: her
 * öğenin bir simgesi ve metni var (renk körlüğü, yüksek kontrast modu).
 * Sorun yoksa öğeler yerine tek bir "her şey yolunda" rozeti çiziliyor;
 * yeşil kutucuk dizisi okunacak bir şey değil.
 */

export type StatusTone = "danger" | "warn" | "info";

export type StatusItem = {
  key: string;
  tone: StatusTone;
  label: string;
  href: string;
};

const TONE_CLASS: Record<StatusTone, string> = {
  danger: "border-danger/40 bg-danger/10 text-danger",
  warn: "border-warn/40 bg-warn/10 text-warn",
  info: "border-line bg-canvas text-subtle",
};

const TONE_ICON = { danger: CircleAlert, warn: AlertTriangle, info: Info } as const;

const ORDER: Record<StatusTone, number> = { danger: 0, warn: 1, info: 2 };

/** `readOnly` (kiosk): öğeler bağlantı değil — dokunmatik ekranda yanlış dokunuş girişe atmasın. */
export function StatusStrip({ items, readOnly = false }: { items: StatusItem[]; readOnly?: boolean }) {
  const t = getT();
  const problems = items.filter((item) => item.tone !== "info");
  const sorted = [...items].sort((a, b) => ORDER[a.tone] - ORDER[b.tone]);

  return (
    <section
      aria-label={t("dashboard.status.title")}
      className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-4 py-3"
    >
      {problems.length === 0 && (
        <span className="mr-1 flex items-center gap-1.5 text-sm font-medium text-ok">
          <CheckCircle2 className="size-4" aria-hidden />
          {t("dashboard.status.allGood")}
        </span>
      )}
      {sorted.map((item) => {
        const Icon = TONE_ICON[item.tone];
        const className = `flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${TONE_CLASS[item.tone]}`;
        const body = (
          <>
            <Icon className="size-3.5 shrink-0" aria-hidden />
            {item.label}
          </>
        );
        return readOnly ? (
          <span key={item.key} className={className}>
            {body}
          </span>
        ) : (
          <Link key={item.key} href={item.href} className={`${className} transition-opacity hover:opacity-80`}>
            {body}
          </Link>
        );
      })}
    </section>
  );
}
