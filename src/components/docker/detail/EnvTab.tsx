"use client";

import { useState } from "react";
import { Eye, EyeOff, FileCode2, Info } from "lucide-react";

import { isSecretName } from "@/lib/text";
import { useFormat, useT } from "@/lib/i18n/client";
import { Rich } from "@/lib/i18n/rich";

import { ComposeSection } from "../ComposeSection";
import { Section } from "./shared";

export type EnvEditContext = {
  containerId: string;
  composeProject: string | null;
  canAct: boolean;
  /** Compose dışı container'da düzenleme YAML sekmesinden; yoksa düğme çizilmez. */
  onEditYaml?: () => void;
};

/**
 * Ortam sekmesi: üstte DÜZENLENEBİLİR olanlar, altta çalışan container'ın
 * gerçek ortamı.
 *
 * İkisi ayrı çünkü aynı şey değiller: çalışan ortamda imajın kendi
 * değişkenleri (PATH, sürüm bilgileri) de var ve onlar compose dosyasında
 * yazmıyor. Compose'a ait container'da düzenleme dosyaya yazılıyor (önizleme,
 * yedek, `compose up` — Compose sekmesiyle aynı yol). Compose dışı bir
 * container'ın ortamı Docker'da sonradan değiştirilemiyor; tek yol container'ı
 * yeniden oluşturmak, o da YAML sekmesinde.
 */
export function EnvTab({ env, edit }: { env: { key: string; value: string }[]; edit: EnvEditContext }) {
  const t = useT();
  return (
    <div className="space-y-5">
      {edit.composeProject ? (
        <ComposeSection
          containerId={edit.containerId}
          composeProject={edit.composeProject}
          canAct={edit.canAct}
          only="environment"
        />
      ) : (
        <div className="flex flex-wrap items-start gap-2 rounded-lg border border-line bg-canvas px-4 py-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden />
          <p className="min-w-0 flex-1 text-subtle">{t("docker.env.notComposeEdit")}</p>
          {edit.onEditYaml && (
            <button
              type="button"
              onClick={edit.onEditYaml}
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs transition-colors hover:border-brand hover:text-brand"
            >
              <FileCode2 className="size-3.5" aria-hidden /> {t("docker.env.editInYaml")}
            </button>
          )}
        </div>
      )}
      <RuntimeEnv env={env} />
    </div>
  );
}

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
function RuntimeEnv({ env }: { env: { key: string; value: string }[] }) {
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
      title={t("docker.env.runtimeTitle", { count: env.length })}
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
