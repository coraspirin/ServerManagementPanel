import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { ArrowRight } from "lucide-react";

/**
 * Gösterge paneli widget'larının ortak kabuğu: başlık, isteğe bağlı "tümü"
 * bağlantısı ve gövde. Hook kullanmıyor; hem sunucu hem istemci
 * bileşenlerinden çağrılabiliyor.
 */
export function WidgetCard({
  title,
  icon: Icon,
  href,
  linkLabel,
  aside,
  children,
}: {
  title: string;
  icon?: ComponentType<{ className?: string }>;
  href?: string;
  linkLabel?: string;
  /** Başlık satırının sağına, bağlantıdan önce. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex h-full min-w-0 flex-col rounded-lg border border-line bg-surface">
      <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        {Icon && <Icon className="size-4 shrink-0 text-subtle" />}
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
        {aside}
        {href && linkLabel && (
          <Link
            href={href}
            className="flex shrink-0 items-center gap-1 text-xs text-subtle transition-colors hover:text-brand"
          >
            {linkLabel} <ArrowRight className="size-3" aria-hidden />
          </Link>
        )}
      </header>
      <div className="min-w-0 flex-1 px-4 py-3">{children}</div>
    </section>
  );
}

/** Boş durum satırı — widget'ın "gösterecek bir şey yok" hali. */
export function WidgetEmpty({ children }: { children: ReactNode }) {
  return <p className="py-4 text-center text-sm text-subtle">{children}</p>;
}

/** Eşik rengi: yüzde değer için ok/warn/danger metin sınıfı. */
export function toneFor(value: number | null, warn: number, crit: number): "ok" | "warn" | "danger" {
  if (value === null) return "ok";
  if (value >= crit) return "danger";
  if (value >= warn) return "warn";
  return "ok";
}

export const TONE_TEXT = { ok: "text-ok", warn: "text-warn", danger: "text-danger" } as const;
export const TONE_BG = { ok: "bg-ok", warn: "bg-warn", danger: "bg-danger" } as const;
