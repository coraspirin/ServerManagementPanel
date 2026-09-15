"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Pencil } from "lucide-react";
import {
  cardColor,
  iconSource,
  initials,
  statusStyle,
  type AppCard,
  type AppCardView,
} from "@/lib/apps/types";
import type { WidgetActionDef, WidgetState } from "@/lib/widgets/types";

/**
 * M2.1 — tek bir uygulama kartı.
 *
 * Kartın tamamı `<a>`: launcher'da en sık yapılan şey açmak, ve tıklanabilir
 * alan ne kadar büyükse dokunmatik ekranda o kadar iyi. Düzenle düğmesi bunun
 * ÜSTÜNDE ayrı bir katman olarak duruyor (M2.2).
 */

function Logo({ card }: { card: AppCardView }) {
  // Favicon adresi çözülmüş adresten türetilmeli: ham `url` içindeki {host}
  // ayrıştırılamaz ve her kart baş harflere düşerdi.
  const source = iconSource({ ...card, url: card.href });
  const [broken, setBroken] = useState(false);
  const color = cardColor(card);

  // Favicon çoğu serviste var, ama yoksa sunucu 404 yerine HTML döndürebiliyor;
  // `onError` her iki durumu da yakalar ve baş harflere düşer.
  if (source.kind === "initials" || broken) {
    return (
      <span
        aria-hidden
        style={{ backgroundColor: color }}
        className="flex size-9 shrink-0 items-center justify-center rounded-md text-sm font-semibold text-white"
      >
        {source.kind === "initials" ? source.text : initials(card.name)}
      </span>
    );
  }

  // next/image kullanılmıyor: dış kaynaklar için `remotePatterns` ister, kart
  // adresleri ise kullanıcıdan geliyor ve önceden bilinemez. Logolar zaten
  // 36 piksel — optimize edilecek bir şey yok.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={source.src}
      alt=""
      width={36}
      height={36}
      onError={() => setBroken(true)}
      className="size-9 shrink-0 rounded-md object-contain"
    />
  );
}

/** Adres satırı: kullanıcıya nereye gideceğini gösterir (şema ve yol olmadan). */
function shortHost(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
  } catch {
    return url;
  }
}

const TONE_CLASS: Record<string, string> = {
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  neutral: "text-ink",
};

/** Kartın altındaki canlı servis verisi (M2.6). */
function Widget({
  state,
  actions,
  busy,
  onAction,
}: {
  state: WidgetState;
  actions: WidgetActionDef[];
  busy: boolean;
  onAction: (action: WidgetActionDef) => void;
}) {
  if (state.status === "error") {
    return (
      <p className="border-t border-line px-3 py-2 text-[11px] leading-snug text-danger">
        {state.message}
      </p>
    );
  }

  const available = actions.filter((action) => state.data.availableActions.includes(action.key));

  return (
    <div className="space-y-2 border-t border-line px-3 py-2">
      <div className="flex gap-4">
        {state.data.stats.map((stat) => (
          <div key={stat.label} className="min-w-0">
            <div className={`text-sm font-semibold ${TONE_CLASS[stat.tone ?? "neutral"]}`}>
              {stat.value}
            </div>
            <div className="truncate text-[10px] text-subtle">{stat.label}</div>
          </div>
        ))}
      </div>

      {state.data.lines.map((line) => (
        <div key={line.label} className="flex gap-2 text-[11px] text-subtle">
          <span className="shrink-0">{line.label}</span>
          <span className="truncate text-ink">{line.value}</span>
        </div>
      ))}

      {state.data.note && <p className="text-[11px] text-warn">{state.data.note}</p>}

      {state.stale && (
        // Tazeliği gizlemek yanlış veriden tehlikelidir: kullanıcı eski sayıya
        // bakıp "her şey yolunda" diye karar verebilir.
        <p className="text-[11px] text-subtle">
          Servise ulaşılamıyor — {new Date(state.updatedAt * 1000).toLocaleTimeString("tr-TR")}{" "}
          verisi gösteriliyor.
        </p>
      )}

      {available.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {available.map((action) => (
            <button
              key={action.key}
              type="button"
              disabled={busy}
              onClick={() => onAction(action)}
              className="rounded border border-line px-2 py-1 text-[11px] transition-colors hover:border-brand disabled:opacity-50"
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AppTile({
  card,
  onEdit,
  move,
  widget,
  widgetActions = [],
  widgetBusy = false,
  onWidgetAction,
}: {
  card: AppCardView;
  onEdit?: (card: AppCard) => void;
  /** Sıralama kipi açıkken verilir; `first`/`last` uç kartlarda oku söndürür. */
  move?: { first: boolean; last: boolean; onMove: (card: AppCard, direction: -1 | 1) => void };
  widget?: WidgetState;
  widgetActions?: WidgetActionDef[];
  widgetBusy?: boolean;
  onWidgetAction?: (card: AppCard, action: WidgetActionDef) => void;
}) {
  const status = statusStyle(card);
  // Widget varken kart tek parça bir kutu olmalı; kenarlık dış sarmalayıcıya
  // taşınıyor ki bağlantı ile veri arasında çift çizgi oluşmasın.
  const framed = widget !== undefined;

  return (
    <div
      className={`group relative ${
        framed ? "overflow-hidden rounded-lg border border-line bg-surface" : ""
      }`}
    >
      <a
        href={card.href}
        // Sıralama kipinde kart bir hedef değil, taşınan bir nesne: tıklayınca
        // servisin açılması sıralamayı imkânsız kılardı.
        onClick={(e) => move && e.preventDefault()}
        target={card.openNewTab && !move ? "_blank" : undefined}
        rel="noreferrer"
        className={`flex items-center gap-3 p-3 transition-colors ${
          framed ? "hover:bg-canvas" : "rounded-lg border border-line bg-surface hover:border-brand"
        } ${card.enabled ? "" : "opacity-50"}`}
      >
        <Logo card={card} />

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            {status && (
              // Renk tek başına bilgi taşımamalı (renk körlüğü): durum metni
              // hem başlıkta hem de ekran okuyucuya açık şekilde veriliyor.
              <span
                title={`${card.monitorName}: ${status.label}`}
                className={`size-2 shrink-0 rounded-full ${status.dot}`}
              >
                <span className="sr-only">{status.label}</span>
              </span>
            )}
            <span className="truncate font-medium">{card.name}</span>
            {card.source === "docker" && (
              // Kullanıcı bu kartın nereden geldiğini bilmeli: sildiğinde geri
              // gelmesi ancak "etiketten geliyor" bilgisiyle anlaşılır.
              <span
                title="Docker etiketlerinden oluşturuldu"
                className="shrink-0 rounded bg-brand/10 px-1 text-[10px] font-medium text-brand"
              >
                etiket
              </span>
            )}
            {card.openNewTab && (
              <ExternalLink className="size-3 shrink-0 text-subtle" aria-hidden />
            )}
          </span>
          <span className="block truncate text-xs text-subtle">
            {card.description || shortHost(card.href)}
          </span>
        </span>
      </a>

      {move && (
        <div className="absolute inset-y-0 right-0 flex items-center gap-0.5 rounded-r-lg bg-surface/90 px-1">
          {([-1, 1] as const).map((direction) => {
            const Icon = direction === -1 ? ChevronLeft : ChevronRight;
            const blocked = direction === -1 ? move.first : move.last;
            return (
              <button
                key={direction}
                type="button"
                disabled={blocked}
                onClick={() => move.onMove(card, direction)}
                aria-label={`${card.name} kartını ${direction === -1 ? "öne" : "sona"} al`}
                className="rounded p-1 text-subtle transition-colors hover:text-ink disabled:opacity-25"
              >
                <Icon className="size-4" />
              </button>
            );
          })}
        </div>
      )}

      {onEdit && !move && (
        <button
          type="button"
          onClick={() => onEdit(card)}
          aria-label={`${card.name} kartını düzenle`}
          // Yalnızca kart üzerindeyken görünür; ama klavyeyle gezenler için
          // odaklanınca da açılmalı, yoksa düğmeye erişilemez.
          className="absolute right-1.5 top-1.5 rounded p-1 text-subtle opacity-0 transition-opacity hover:bg-canvas hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Pencil className="size-3.5" />
        </button>
      )}

      {widget && !move && (
        <Widget
          state={widget}
          actions={widgetActions}
          busy={widgetBusy}
          onAction={(action) => onWidgetAction?.(card, action)}
        />
      )}
    </div>
  );
}
