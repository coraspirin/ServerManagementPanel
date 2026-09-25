import Link from "next/link";

import { LinkPending } from "@/components/shell/LinkPending";
import { settingGroups } from "@/settings.schema";
import { settingsGroupText } from "@/lib/i18n/lookup";
import { getActiveDictionary, getT } from "@/lib/i18n/server";

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
 *
 * Geniş ekranda sekmeler alt satıra sarılıyor: tek satırda 19 kategori
 * hiçbir ekrana sığmıyordu ve sağda kalanlar gizli kaydırmada kayboluyordu.
 * Dar ekranda tek satır kalıyor ama kaydırma çubuğu görünür.
 */
export function SettingsTabs({ active }: { active: string }) {
  const t = getT();
  const dict = getActiveDictionary();

  return (
    <nav
      aria-label={t("settings.tabs.label")}
      className="thin-scrollbar -mx-1 flex overflow-x-auto border-b border-line pb-px lg:flex-wrap lg:overflow-visible lg:pb-0"
    >
      {settingGroups.map((group) => {
        const secili = group.key === active;
        const text = settingsGroupText(dict, group.key);

        return (
          <Link
            key={group.key}
            href={`/settings/${group.key}`}
            aria-current={secili ? "page" : undefined}
            title={text?.description}
            className={`-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2 py-1.5 text-sm transition-colors ${
              secili
                ? "border-brand font-medium text-brand"
                : "border-transparent text-subtle hover:text-ink"
            }`}
          >
            {text?.label ?? group.key}
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
