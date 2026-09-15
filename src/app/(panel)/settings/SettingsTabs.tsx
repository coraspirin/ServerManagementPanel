import Link from "next/link";

import { LinkPending } from "@/components/shell/LinkPending";
import { settingGroups } from "@/settings.schema";

/**
 * Ayar kategorilerinin yatay sekme çubuğu (M3.42).
 *
 * Kategoriler bugüne kadar YALNIZCA menüdeki açılır listede vardı. Bir
 * kategoriden diğerine geçmek için önce menüyü açmak, sonra doğru başlığı
 * bulmak gerekiyordu — 19 kategori arasında dolaşırken bu her seferinde iki
 * fazladan adım.
 *
 * Kaynak `settings.schema.ts`: menü de aynı listeden besleniyor
 * ([nav.ts](../../../lib/nav.ts) `settingsChildren`). İkinci bir liste tutmak,
 * şemaya eklenen bir kategorinin birinde görünüp diğerinde görünmemesi
 * demekti.
 *
 * Sunucu bileşeni: hiçbir durum tutmuyor, yalnızca hangi sekmenin etkin
 * olduğunu biliyor — istemciye JavaScript göndermenin gereği yok.
 */
export function SettingsTabs({ active }: { active: string }) {
  return (
    <nav
      aria-label="Ayar kategorileri"
      className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto border-b border-line"
    >
      {settingGroups.map((group) => {
        const secili = group.key === active;

        return (
          <Link
            key={group.key}
            href={`/settings/${group.key}`}
            aria-current={secili ? "page" : undefined}
            title={group.description}
            className={`-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${
              secili
                ? "border-brand font-medium text-brand"
                : "border-transparent text-subtle hover:text-ink"
            }`}
          >
            {group.label}
            {/*
              Sekme geçişi de sunucu yanıtı bekliyor (M3.45): 19 kategori
              arasında dolaşırken tıklamanın işlenip işlenmediği görünmeliydi.
              Bileşen istemci, çubuk sunucu bileşeni olarak kalıyor.
            */}
            <LinkPending />
          </Link>
        );
      })}
    </nav>
  );
}
