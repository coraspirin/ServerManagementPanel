"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CornerDownRight, RotateCcw, Search } from "lucide-react";
import { ConfigTransfer } from "@/components/settings/ConfigTransfer";
import type { ResolvedSetting, SettingDef, SettingGroupDef } from "@/lib/settings/types";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import { CronEditor } from "@/components/settings/CronEditor";
import {
  ContainerMultiSelect,
  ContainerSelect,
} from "@/components/settings/ContainerSelect";
import { DirListEditor, DirPicker } from "@/components/settings/DirPicker";
import { OwnerSelect } from "@/components/settings/HostUserSelect";
import { RichTextField } from "@/components/settings/RichTextField";
import { settingDefs, settingGroups } from "@/settings.schema";
import { useDict, useLocale, useT } from "@/lib/i18n/client";
import {
  settingItemText,
  settingSectionText,
  settingsGroupText,
  type SettingItemText,
} from "@/lib/i18n/runtime";
import { intlLocale, type Locale } from "@/lib/i18n/locales";
import type { Dictionary } from "@/lib/i18n/dict/tr";

/**
 * Geniş bir denetim isteyen ayar tipleri.
 *
 * Satır düzeni varsayılan olarak "solda açıklama, sağda dar kutu"; klasör
 * listesi ya da container onay kutuları o dar sütuna sığmıyor ve sığdırmaya
 * çalışmak onları okunmaz yapıyordu.
 */
const WIDE_TYPES = new Set(["cron", "containers", "dirs", "owner", "richtext"]);

type DefWithSeed = SettingDef & { seededFromEnv?: boolean };
type Section = { title: string | null; defs: DefWithSeed[] };

type Props = {
  group: SettingGroupDef;
  sections: Section[];
  initialValues: ResolvedSetting[];
  canEdit: boolean;
  initialQuery: string;
};

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

/**
 * Arama, ekranda GÖRÜNEN metne bakar: kullanıcı ne okuduysa onu yazıyor.
 * Anahtar da aranıyor çünkü "docker.stats" gibi bir anahtarı hatırlayan da var.
 */
function matches(def: SettingDef, query: string, dict: Dictionary, locale: Locale): boolean {
  const text = settingItemText(dict, def.key);
  const section = def.section ? settingSectionText(dict, def.section) : null;

  return [def.key, text?.label ?? "", section ?? "", text?.help ?? ""].some((candidate) =>
    candidate.toLocaleLowerCase(intlLocale(locale)).includes(query),
  );
}

/**
 * Tek bir ayar kategorisi. İçerik tamamen şemadan üretilir (T9): tip → widget
 * eşlemesi, doğrulama, audit ve "varsayılana dön" bedava gelir.
 *
 * Kategori değişince bileşen üst sayfadaki `key` ile yeniden kurulur; arama
 * kutusu ve taslak değerler önceki kategoriden sızmaz.
 */
export function SettingsScreen({
  group,
  sections,
  initialValues,
  canEdit,
  initialQuery,
}: Props) {
  const t = useT();
  const dict = useDict();
  const locale = useLocale();

  // Kategori adı sözlükten geliyor: şema artık yalnızca anahtarı tutuyor.
  // Karşılığı yoksa anahtarın kendisi gösteriliyor — boş başlıktan iyidir.
  const groupText = settingsGroupText(dict, group.key);
  const groupLabel = groupText?.label ?? group.key;
  const groupDescription = groupText?.description;

  const [values, setValues] = useState(
    () => new Map(initialValues.map((v) => [v.key, v])),
  );
  const [query, setQuery] = useState(initialQuery);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [saved, setSaved] = useState<string | null>(null);

  const needle = query.trim().toLocaleLowerCase(intlLocale(locale));

  const visibleSections = useMemo(() => {
    if (!needle) return sections;
    return sections
      .map((section) => ({
        ...section,
        defs: section.defs.filter((def) => matches(def, needle, dict, locale)),
      }))
      .filter((section) => section.defs.length > 0);
  }, [sections, needle, dict, locale]);

  /**
   * Aranan şey başka bir kategorideyse kullanıcı bunu bilemez — kategori
   * sayfaları birbirinden habersizdir. Bu yüzden diğer kategorilerdeki
   * eşleşmeler sayılıp bağlantı olarak sunuluyor.
   */
  const elsewhere = useMemo(() => {
    if (!needle) return [];
    const counts = new Map<string, number>();
    for (const def of settingDefs) {
      if (def.group === group.key || !matches(def, needle, dict, locale)) continue;
      counts.set(def.group, (counts.get(def.group) ?? 0) + 1);
    }
    return settingGroups
      .filter((candidate) => counts.has(candidate.key))
      .map((candidate) => ({ ...candidate, count: counts.get(candidate.key) ?? 0 }));
  }, [needle, group.key, dict, locale]);

  async function send(key: string, payload: Record<string, unknown>) {
    setBusyKey(key);
    setErrors((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });

    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          [CSRF_HEADER]: readCsrfToken(),
        },
        body: JSON.stringify({ key, ...payload }),
      });
      const data = await response.json();

      if (!response.ok) {
        setErrors((prev) => new Map(prev).set(key, data.error ?? t("common.errors.notSaved")));
        return;
      }

      // Dil değişti: sözlük kök layout'ta seçiliyor, sayfa başlığı ve
      // <html lang> de oradan geliyor. `router.refresh()` yalnızca istemci
      // ağacını tazeler ve ikisi eski dilde kalırdı — tam yeniden yükleme
      // burada dürüst olan yol.
      if (key === "general.language") {
        window.location.reload();
        return;
      }

      setValues(new Map((data.values as ResolvedSetting[]).map((v) => [v.key, v])));
      setSaved(key);
      setTimeout(() => setSaved((s) => (s === key ? null : s)), 1800);
    } catch {
      setErrors((prev) => new Map(prev).set(key, t("common.errors.network")));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("settings.screen.searchPlaceholder", { group: groupLabel })}
            className="w-full rounded-md border border-line bg-surface py-2 pl-9 pr-3 text-sm outline-none focus:border-brand"
          />
        </div>

        {elsewhere.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-subtle">
            <span className="flex items-center gap-1">
              <CornerDownRight className="size-3.5" aria-hidden />
              {t("settings.screen.elsewhere")}
            </span>
            {elsewhere.map((candidate) => (
              <Link
                key={candidate.key}
                href={`/settings/${candidate.key}?q=${encodeURIComponent(query.trim())}`}
                className="text-brand hover:underline"
              >
                {settingsGroupText(dict, candidate.key)?.label ?? candidate.key} ({candidate.count})
              </Link>
            ))}
          </div>
        )}
      </div>

      {groupDescription && !needle && (
        <p className="px-1 text-sm text-subtle">{groupDescription}</p>
      )}

      {visibleSections.map((section, index) => (
        <section
          key={section.title ?? `__${index}`}
          className="rounded-lg border border-line bg-surface"
        >
          {section.title && (
            <div className="border-b border-line px-5 py-2.5">
              <h2 className="text-sm font-semibold">
                {settingSectionText(dict, section.title) ?? section.title}
              </h2>
            </div>
          )}

          <div className="divide-y divide-line">
            {section.defs.map((def) => {
              const resolved = values.get(def.key);
              const overridden = resolved?.source !== "default";
              const error = errors.get(def.key);
              // Sözlükte karşılığı yoksa anahtarın kendisi gösteriliyor:
              // boş bir satır, ayarın kaybolduğunu düşündürürdü.
              const text = settingItemText(dict, def.key);

              return (
                <div
                  key={def.key}
                  className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 sm:max-w-md">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{text?.label ?? def.key}</span>
                      {def.overridable && (
                        <span
                          title={t("settings.screen.overridableTitle")}
                          className="rounded bg-brand/10 px-1 text-[10px] font-medium text-brand"
                        >
                          {t("settings.screen.overridable")}
                        </span>
                      )}
                      {def.restartRequired && (
                        <span className="rounded bg-warn/15 px-1 text-[10px] font-medium text-warn">
                          {t("settings.screen.restartRequired")}
                        </span>
                      )}
                      {def.seededFromEnv && (
                        <span
                          title={t("settings.screen.seededTitle")}
                          className="rounded border border-line px-1 text-[10px] text-subtle"
                        >
                          {t("settings.screen.seeded")}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 font-mono text-[11px] text-subtle">{def.key}</p>
                    {text?.help && <p className="mt-1 text-xs text-subtle">{text.help}</p>}
                    {resolved?.unreadable && (
                      // Boş bir alan "hiç girilmedi" demek. Oysa değer GİRİLDİ,
                      // sadece okunamıyor — sebebi söylenmezse kullanıcı
                      // panelin unuttuğunu sanır.
                      <p className="mt-1 text-xs text-warn">
                        {t("settings.screen.unreadable")}
                      </p>
                    )}
                    {error && <p className="mt-1 text-xs text-danger">{error}</p>}
                  </div>

                  <div
                    className={`flex items-start gap-2 ${
                      WIDE_TYPES.has(def.type) ? "sm:w-96 sm:shrink-0" : "shrink-0 items-center"
                    }`}
                  >
                    <SettingInput
                      def={def}
                      text={text}
                      value={resolved?.value ?? def.default}
                      disabled={!canEdit || busyKey === def.key}
                      onCommit={(value) => send(def.key, { value })}
                    />
                    {saved === def.key && (
                      <span className="text-xs text-ok">{t("settings.screen.saved")}</span>
                    )}
                    {overridden && canEdit && (
                      <button
                        type="button"
                        title={t("settings.screen.resetTitle", { value: String(def.default) })}
                        onClick={() => send(def.key, { reset: true })}
                        disabled={busyKey === def.key}
                        className="rounded border border-line p-1.5 text-subtle transition-colors hover:text-ink disabled:opacity-50"
                      >
                        <RotateCcw className="size-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {visibleSections.length === 0 && (
        <p className="rounded-lg border border-dashed border-line bg-surface px-5 py-8 text-center text-sm text-subtle">
          {t("settings.screen.noMatch", { group: groupLabel, query })}
        </p>
      )}

      {/* Yapılandırma aktarımı GENEL kategorisinde: kapsamı tek bir grup değil
          panelin tamamı, ve her kategoride tekrarlanması kafa karıştırırdı. */}
      {group.key === "general" && canEdit && !query && <ConfigTransfer />}
    </div>
  );
}

/** Tip → widget eşlemesi. Yeni bir tip eklenirse yalnızca burası genişler. */
function SettingInput({
  def,
  text,
  value,
  disabled,
  onCommit,
}: {
  def: SettingDef;
  /** Ayarın çevrilmiş metni: başlık, birim ve enum seçeneklerinin adları. */
  text: SettingItemText | null;
  value: string | number | boolean;
  disabled: boolean;
  onCommit: (value: string | number | boolean) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState(String(value));
  const inputClass =
    "w-full rounded-md border border-line bg-canvas px-2 py-1.5 text-sm outline-none focus:border-brand disabled:opacity-50 sm:w-40";

  // Ham cron ifadesi kullanıcıya hiç gösterilmez; sıklık seçicisi kullanılır.
  if (def.type === "cron") {
    return <CronEditor value={String(value)} disabled={disabled} onCommit={onCommit} />;
  }

  /*
    M3.45 — çalışma zamanı verisinden beslenen alanlar.

    Hepsi elle yazılan metin kutusuydu ve hepsinde aynı arıza sınıfı vardı:
    yazım hatası kabul ediliyor, kaydediliyor ve İŞ SESSİZCE ÇALIŞMIYOR.
    Değerin biçimi değişmedi, yalnızca yanlış değer girmek zorlaştı.
  */
  if (def.type === "container") {
    return <ContainerSelect value={String(value)} disabled={disabled} onCommit={onCommit} />;
  }

  if (def.type === "containers") {
    return (
      <ContainerMultiSelect
        value={String(value)}
        disabled={disabled}
        onCommit={onCommit}
        emptyMeans={t("settings.screen.containersEmpty")}
      />
    );
  }

  if (def.type === "dir") {
    return <DirPicker value={String(value)} disabled={disabled} onCommit={onCommit} />;
  }

  if (def.type === "dirs") {
    return <DirListEditor value={String(value)} disabled={disabled} onCommit={onCommit} />;
  }

  if (def.type === "owner") {
    return <OwnerSelect value={String(value)} disabled={disabled} onCommit={onCommit} />;
  }

  if (def.type === "richtext") {
    return (
      <RichTextField
        value={String(value)}
        disabled={disabled}
        onCommit={onCommit}
        title={text?.label ?? def.key}
      />
    );
  }

  if (def.type === "bool") {
    return (
      <input
        type="checkbox"
        checked={Boolean(value)}
        disabled={disabled}
        onChange={(e) => onCommit(e.target.checked)}
        className="size-4 accent-[var(--brand)]"
      />
    );
  }

  if (def.type === "enum") {
    return (
      <select
        value={String(value)}
        disabled={disabled}
        onChange={(e) => onCommit(e.target.value)}
        className={inputClass}
      >
        {def.options?.map((option) => (
          <option key={option} value={option}>
            {text?.options?.[option] ?? option}
          </option>
        ))}
      </select>
    );
  }

  const isNumeric = def.type === "int" || def.type === "float";

  return (
    <div className="flex items-center gap-1.5">
      <input
        type={
          def.type === "secret"
            ? "password"
            : def.type === "time"
              ? "time"
              : isNumeric
                ? "number"
                : "text"
        }
        value={draft}
        min={def.min}
        max={def.max}
        disabled={disabled}
        placeholder={def.type === "secret" ? "••••••••" : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== String(value)) onCommit(isNumeric ? Number(draft) : draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setDraft(String(value));
        }}
        className={inputClass}
      />
      {text?.unit && <span className="w-8 text-xs text-subtle">{text.unit}</span>}
    </div>
  );
}
