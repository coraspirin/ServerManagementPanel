"use client";

import { useState } from "react";
import { statusStyle } from "@/lib/apps/types";
import type { PublicAppCard, PublicAppGroup } from "@/lib/apps/types";
import { useT } from "@/lib/i18n/client";

/**
 * Karşılama sayfasının kare kutu ızgarası.
 *
 * `AppTile` yeniden KULLANILMIYOR — `LoginApps`'te olduğu gibi ve aynı
 * gerekçeyle: o bileşen `AppCardView` bekliyor ve bir server component'ten
 * geçirilen her alan HTML payload'ına yazılıyor. Kartın iç adresi, container
 * adı ve monitör bağı oturum açmamış ziyaretçinin kaynak kodunda görünürdü.
 * Bu ekranın tamamı `PublicAppCard` görüyor.
 *
 * Kutuda yalnızca logo, ad ve (yalnızca oturum açıkken dolan) durum noktası
 * var. Açıklama ve adres satırı bilerek yok: panel içinde bilgi, karşılamada
 * dışarıya anlatılacak bir şey değil.
 *
 * İstemci bileşeni olmasının tek sebebi logo `onError` yedeği — kırık bir
 * logoda baş harflere düşmek için tarayıcı olayı gerekiyor.
 */

function Logo({ card }: { card: PublicAppCard }) {
  const [broken, setBroken] = useState(false);

  if (card.iconSrc === null || broken) {
    return (
      <span
        aria-hidden
        style={{ backgroundColor: card.color }}
        className="flex size-12 shrink-0 items-center justify-center rounded-xl text-base font-semibold text-white"
      >
        {card.initials}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- bkz. AppTile
    <img
      src={card.iconSrc}
      alt=""
      width={48}
      height={48}
      onError={() => setBroken(true)}
      className="size-12 shrink-0 rounded-xl object-contain"
    />
  );
}

function Tile({ card }: { card: PublicAppCard }) {
  const t = useT();
  const status = statusStyle(card);

  return (
    <a
      href={card.href}
      target={card.openNewTab ? "_blank" : undefined}
      // Panelin adresi hedef servise gönderilmemeli: kartlar dışarıdan da
      // tıklanabiliyor.
      rel="noreferrer"
      className="relative flex aspect-square flex-col items-center justify-center gap-2.5 rounded-xl border border-line bg-surface p-3 transition-colors hover:border-brand"
    >
      {status && (
        <span
          title={t(status.label)}
          aria-label={t(status.label)}
          className={`absolute right-2 top-2 size-2 rounded-full ${status.dot}`}
        />
      )}
      <Logo card={card} />
      <span className="line-clamp-2 w-full text-center text-xs font-medium leading-tight">
        {card.name}
      </span>
    </a>
  );
}

export function WelcomeTiles({ groups }: { groups: PublicAppGroup[] }) {
  return (
    <div className="space-y-7">
      {groups.map((group) => (
        <section key={group.name}>
          <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-subtle">
            {group.name}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {group.cards.map((card) => (
              <Tile key={card.id} card={card} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
