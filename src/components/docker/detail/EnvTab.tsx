"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { isSecretName } from "@/lib/text";
import { useFormat, useT } from "@/lib/i18n/client";
import { Rich } from "@/lib/i18n/rich";

import { Section } from "./shared";

/**
 * Ortam değişkenleri — sır taşıyan değerler VARSAYILAN OLARAK maskeli.
 *
 * Öncesinde hepsi düz metin basılıyordu ve üstünde "parola içerebilir" diyen
 * bir uyarı vardı. Uyarı maskeleme değildir: bu ekran omuz üstünden okunabilir,
 * ekran görüntüsü alınabilir, sunum sırasında yansıtılabilir. M1.8 sırasında
 * gerçek sunucuda Pi-hole'un `WEBPASSWORD` değeri düpedüz ekrandaydı.
 *
 * Ada bakılıyor, değere değil (bkz. `isSecretName`) — ve ölçüt eksik
 * yakalayabileceği için uyarı metni de KALIYOR.
 *
 * M3.20'de `<details>` içinden çıkıp kendi sekmesine taşındı: 40 değişkenli bir
 * container'da açılıp kapanan bir kutu, aranabilir bir liste değildi.
 */
export function EnvTab({ env }: { env: { key: string; value: string }[] }) {
  const t = useT();
  const f = useFormat();
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  const secrets = env.filter((entry) => isSecretName(entry.key)).length;
  const query = f.lower(filter.trim());
  const filtered = query
    ? env.filter(
        (entry) => f.lower(entry.key).includes(query) || f.lower(entry.value).includes(query),
      )
    : env;

  const toggle = (key: string) =>
    setShown((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (env.length === 0) {
    return (
      <Section title={t("docker.env.title")}>
        <p className="text-sm text-subtle">{t("docker.env.empty")}</p>
      </Section>
    );
  }

  return (
    <Section
      title={t("docker.env.titleCount", { count: env.length })}
      action={
        secrets > 0 ? (
          <span className="text-xs text-warn">{t("docker.env.masked", { count: secrets })}</span>
        ) : null
      }
    >
      <input
        type="search"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder={t("docker.env.search")}
        className="mb-2 w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand"
      />

      <p className="mb-2 text-[11px] text-warn">
        <Rich
          text={t("docker.env.maskNote")}
          values={{ name: <strong>{t("docker.env.maskNoteName")}</strong> }}
        />
      </p>

      {filtered.length === 0 ? (
        <p className="text-sm text-subtle">{t("docker.env.noMatch")}</p>
      ) : (
        <ul className="space-y-0.5 break-all font-mono text-[11px]">
          {filtered.map((entry) => {
            const sirli = isSecretName(entry.key);
            const gizli = sirli && !shown.has(entry.key);

            return (
              <li key={entry.key} className="flex items-start gap-1.5">
                <span className="min-w-0 flex-1">
                  <span className="text-subtle">{entry.key}=</span>
                  {gizli ? <span className="text-subtle">••••••••</span> : entry.value}
                </span>

                {sirli && (
                  <button
                    type="button"
                    onClick={() => toggle(entry.key)}
                    title={gizli ? t("docker.env.show") : t("docker.env.hide")}
                    className="shrink-0 text-subtle transition-colors hover:text-brand"
                  >
                    {gizli ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-3 text-xs text-subtle">
        <Rich
          text={t("docker.env.runtimeNote")}
          values={{
            strong: <strong>{t("docker.env.runtimeOwner")}</strong>,
            cmd: <code className="font-mono">compose up</code>,
          }}
        />
      </p>
    </Section>
  );
}
