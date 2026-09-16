"use client";

import { useMemo, useState } from "react";
import { Bookmark as BookmarkIcon, Search } from "lucide-react";
import type { AppGroup } from "@/lib/apps/types";
import type { BookmarkGroup } from "@/lib/home/bookmarks";
import { useFormat, useT } from "@/lib/i18n/client";

/**
 * M2.7 — ana sayfadaki arama + kısayollar.
 *
 * Arama kart ve bookmark'ları BİRLİKTE süzüyor: kullanıcı "pihole" yazarken
 * onun kart mı bookmark mı olduğunu düşünmüyor, sadece oraya gitmek istiyor.
 *
 * Enter, ilk sonucu açar — klavyeyle çalışan biri için launcher'ın tamamı
 * "yaz, enter" oluyor.
 */

type Entry = { key: string; title: string; subtitle: string; href: string; kind: "app" | "bookmark" };

export function QuickLinks({
  apps,
  bookmarks,
  compact = false,
}: {
  apps: AppGroup[];
  bookmarks: BookmarkGroup[];
  /** Ev halkı/kiosk görünümünde arama kutusu gizlenir. */
  compact?: boolean;
}) {
  const t = useT();
  const f = useFormat();
  const [query, setQuery] = useState("");

  const entries = useMemo<Entry[]>(
    () => [
      ...apps.flatMap((group) =>
        group.cards
          .filter((card) => card.enabled)
          .map((card) => ({
            key: `app-${card.id}`,
            title: card.name,
            subtitle: card.description || (group.category?.name ?? ""),
            href: card.href,
            kind: "app" as const,
          })),
      ),
      ...bookmarks.flatMap((group) =>
        group.items.map((item) => ({
          key: `bm-${item.id}`,
          title: item.title,
          subtitle: group.name,
          href: item.url,
          kind: "bookmark" as const,
        })),
      ),
    ],
    [apps, bookmarks],
  );

  const needle = f.lower(query.trim());
  const results = needle
    ? entries.filter((entry) =>
        f.lower(`${entry.title} ${entry.subtitle} ${entry.href}`).includes(needle),
      )
    : [];

  return (
    <div className="space-y-4">
      {!compact && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const first = results[0];
            if (first) window.open(first.href, "_blank", "noreferrer");
          }}
        >
          <label className="relative block">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("home.quicklinks.search")}
              aria-label={t("home.quicklinks.searchAria")}
              className="w-full rounded-lg border border-line bg-surface py-2.5 pl-9 pr-3 text-sm outline-none focus:border-brand"
            />
          </label>
        </form>
      )}

      {needle ? (
        results.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line bg-surface px-5 py-6 text-center text-sm text-subtle">
            {t("home.quicklinks.noMatch", { query })}
          </p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
            {results.map((entry) => (
              <li key={entry.key}>
                <a
                  href={entry.href}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-canvas"
                >
                  {entry.kind === "bookmark" && (
                    <BookmarkIcon className="size-3.5 shrink-0 text-subtle" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {entry.title}
                  </span>
                  <span className="hidden shrink-0 text-xs text-subtle sm:block">
                    {entry.subtitle}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )
      ) : (
        <BookmarkSections groups={bookmarks} />
      )}
    </div>
  );
}

function BookmarkSections({ groups }: { groups: BookmarkGroup[] }) {
  const t = useT();
  if (groups.length === 0) return null;

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section key={group.name || "diger"}>
          <h3 className="mb-2 text-xs font-semibold text-subtle">
            {group.name || t("home.bookmarks.title")}
          </h3>
          <div className="flex flex-wrap gap-2">
            {group.items.map((item) => (
              <a
                key={item.id}
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm transition-colors hover:border-brand"
              >
                {item.title}
              </a>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
