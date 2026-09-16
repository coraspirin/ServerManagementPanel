"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { HelpCircle } from "lucide-react";
import { Modal } from "@/components/Modal";
import { helpFor } from "@/lib/help";
import { settingGroups } from "@/settings.schema";
import { useDict, useT } from "@/lib/i18n/client";
import { settingsGroupText } from "@/lib/i18n/lookup";
import type { Dictionary } from "@/lib/i18n/locales";

/**
 * Sayfa yardımı — başlık çubuğundaki "?" düğmesi.
 *
 * TEK YERDE duruyor: `AppShell` zaten `usePathname()` ile hangi sayfada
 * olduğumuzu biliyor ve başlığı ondan üretiyor. Yardımı da buraya koymak,
 * yirmi küsur sayfayı tek tek düzenlemek yerine tek bir düğme demek — ve yeni
 * bir sayfa eklendiğinde yardım metnini eklemeyi unutmak dışında bir bakım
 * yükü doğurmuyor.
 */
export function PageHelp() {
  const t = useT();
  const dict = useDict();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const entry = helpFor(pathname, dict);
  const settings = settingsHelp(pathname, dict);

  // Kaydı olmayan bir yolda düğme GİZLENİYOR. Boş bir pencere açan bir düğme,
  // bir dahaki sefere hiç tıklanmaz.
  if (!entry && !settings) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t("shell.help.button")}
        aria-label={t("shell.help.button")}
        className="rounded p-1 text-subtle transition-colors hover:text-ink"
      >
        <HelpCircle className="size-4.5" />
      </button>

      <Modal
        open={open}
        title={settings ? settings.baslik : t("shell.help.button")}
        onClose={() => setOpen(false)}
      >
        {settings ? (
          <p className="text-sm leading-relaxed text-subtle">{settings.aciklama}</p>
        ) : (
          entry && (
            <div className="space-y-3 text-sm leading-relaxed">
              <p>{entry.amac}</p>

              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">
                  {t("shell.help.how")}
                </h3>
                <p className="text-subtle">{entry.nasil}</p>
              </div>

              {entry.dikkat && (
                <div className="rounded-md border border-warn/40 bg-warn/5 px-3 py-2">
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-warn">
                    {t("shell.help.caution")}
                  </h3>
                  <p className="text-subtle">{entry.dikkat}</p>
                </div>
              )}
            </div>
          )
        )}
      </Modal>
    </>
  );
}

/**
 * Ayarların alt sayfaları için metin, şemadaki grup açıklamasından geliyor.
 *
 * O açıklama zaten yazılı ve ayarlar listesinin başında görünüyor; ikinci bir
 * kopya tutmak, ikisinin zamanla ayrışması demekti. Yeni bir ayar grubu
 * eklendiğinde yardımı da kendiliğinden gelmiş oluyor.
 */
function settingsHelp(
  pathname: string,
  dict: Dictionary,
): { baslik: string; aciklama: string } | null {
  if (!pathname.startsWith("/settings/")) return null;

  const key = pathname.slice("/settings/".length).split("/")[0];
  const group = settingGroups.find((entry) => entry.key === key);
  if (!group) return null;

  // Açıklaması olmayan bir grup için düğmeyi göstermek, boş bir pencere
  // açmak olurdu.
  const text = settingsGroupText(dict, group.key);
  if (!text?.description) return null;

  return { baslik: text.label, aciklama: text.description };
}
