"use client";

import { useState } from "react";
import { useContainerNames } from "@/components/settings/ContainerSelect";
import {
  MONITOR_TYPES,
  type Monitor,
  type MonitorType,
} from "@/lib/monitors/types";
import { useDynamicT, useT } from "@/lib/i18n/client";

/**
 * Monitör ekleme/düzenleme formu (M1.2).
 *
 * ## Zamanlama alanları artık DOLU açılıyor (M3.45)
 *
 * Önceden boştular ve yer tutucuda "varsayılan: 60" yazıyordu. Yer tutucu
 * gri bir metin — kullanıcı onu "kayıtlı değer" ile karıştırıyor, ne
 * olduğunu anlamak için ayrı bir okuma yapmak zorunda kalıyordu. Şimdi
 * kutuda gerçek sayı duruyor: görülen şey kaydedilecek şey.
 *
 * Devralma KAYBOLMADI, açık bir düğmeye dönüştü ("Genel ayarları kullan").
 * Boş bir alan hâlâ "ayarlardaki global değeri kullan" demek; fark, boşluğun
 * artık varsayılan durum olmaması.
 *
 * ## Container hedefi seçiliyor, yazılmıyor
 *
 * "Docker container" tipinde hedef bir container ADI ve yazım hatası sessiz:
 * monitör kurulur, her kontrolde "container yok" der ve kullanıcı adı
 * karşılaştırana kadar sebebini bulamaz. Liste `/api/docker`den geliyor.
 */

export type MonitorFormValues = {
  name: string;
  type: MonitorType;
  target: string;
  expected: string;
  enabled: boolean;
  ignoreTls: boolean;
  intervalSeconds: string;
  timeoutSeconds: string;
  retries: string;
  downThreshold: string;
};

export type GlobalDefaults = {
  intervalSeconds: number;
  timeoutSeconds: number;
  retries: number;
  downThreshold: number;
};

export function emptyMonitorForm(defaults: GlobalDefaults): MonitorFormValues {
  return {
    name: "",
    type: "http",
    target: "",
    expected: "",
    enabled: true,
    ignoreTls: false,
    intervalSeconds: String(defaults.intervalSeconds),
    timeoutSeconds: String(defaults.timeoutSeconds),
    retries: String(defaults.retries),
    downThreshold: String(defaults.downThreshold),
  };
}

export function monitorToForm(monitor: Monitor, defaults: GlobalDefaults): MonitorFormValues {
  // `null` = bu monitörde ezme yok. Kutuya yine de global değer yazılıyor;
  // kullanıcı orada ne yazdığını görüyor ve dokunmazsa aynı sayı kaydediliyor.
  return {
    name: monitor.name,
    type: monitor.type,
    target: monitor.target,
    expected: monitor.expected,
    enabled: monitor.enabled,
    ignoreTls: monitor.ignoreTls,
    intervalSeconds: String(monitor.intervalSeconds ?? defaults.intervalSeconds),
    timeoutSeconds: String(monitor.timeoutSeconds ?? defaults.timeoutSeconds),
    retries: String(monitor.retries ?? defaults.retries),
    downThreshold: String(monitor.downThreshold ?? defaults.downThreshold),
  };
}

const inputClass =
  "w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand disabled:opacity-50";

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium">{label}</span>
      <div className="mt-1">{children}</div>
      {help && <p className="mt-1 text-[11px] leading-snug text-subtle">{help}</p>}
    </label>
  );
}

export function MonitorForm({
  values,
  defaults,
  busy,
  error,
  onChange,
  onSubmit,
  onCancel,
}: {
  values: MonitorFormValues;
  defaults: GlobalDefaults;
  busy: boolean;
  error: string | null;
  onChange: (patch: Partial<MonitorFormValues>) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  /*
    Bölüm yalnızca GERÇEK bir sapma varsa açık geliyor. Alanlar artık global
    değerlerle dolu olduğu için "boş değil" ölçütü işe yaramıyordu: her form
    açılışında dört alanlı gelişmiş bölüm de açılırdı.
  */
  const t = useT();
  const dt = useDynamicT();
  const [showAdvanced, setShowAdvanced] = useState(
    values.intervalSeconds !== String(defaults.intervalSeconds) ||
      values.timeoutSeconds !== String(defaults.timeoutSeconds) ||
      values.retries !== String(defaults.retries) ||
      values.downThreshold !== String(defaults.downThreshold),
  );

  const { names: containerNames } = useContainerNames();

  const isHttps = values.type === "http" && values.target.startsWith("https://");
  const usesExpected = values.type !== "tcp" && values.type !== "ping";

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <Field label={t("users.roles.name")}>
        <input
          type="text"
          value={values.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Home Assistant"
          className={inputClass}
          autoFocus
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("monitorForm.what")}>
          <select
            value={values.type}
            onChange={(e) => onChange({ type: e.target.value as MonitorType })}
            className={inputClass}
          >
            {MONITOR_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {dt(`monitorType.${type.value}.label`)}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label={t("proxy.form.target")}
          help={
            values.type === "container" && containerNames
              ? t("monitorForm.containerHelp")
              : dt(`monitorType.${values.type}.hint`)
          }
        >
          {values.type === "container" && containerNames && containerNames.length > 0 ? (
            <select
              value={values.target}
              onChange={(e) => {
                const target = e.target.value;
                // Ad boşsa container adıyla dolduruluyor; DOLU olan bir adın
                // üzerine yazmak, kullanıcının verdiği ismi silmek olurdu.
                onChange(values.name.trim() === "" ? { target, name: target } : { target });
              }}
              className={`font-mono ${inputClass}`}
            >
              <option value="">{t("monitorForm.pickContainer")}</option>
              {!containerNames.includes(values.target) && values.target !== "" && (
                <option value={values.target}>
                  {t("appForm.notInList", { name: values.target })}
                </option>
              )}
              {containerNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={values.target}
              onChange={(e) => onChange({ target: e.target.value })}
              className={`font-mono ${inputClass}`}
            />
          )}
        </Field>
      </div>

      {usesExpected && (
        <Field label={t("monitorForm.expected")} help={dt(`monitorType.${values.type}.expected`)}>
          <input
            type="text"
            value={values.expected}
            onChange={(e) => onChange({ expected: e.target.value })}
            className={`font-mono ${inputClass}`}
          />
        </Field>
      )}

      {isHttps && (
        <label className="flex items-start gap-2 rounded-md border border-line bg-canvas px-3 py-2">
          <input
            type="checkbox"
            checked={values.ignoreTls}
            onChange={(e) => onChange({ ignoreTls: e.target.checked })}
            className="mt-0.5 size-4 accent-[var(--brand)]"
          />
          <span className="text-xs">
            <span className="font-medium">{t("monitorForm.ignoreTls")}</span>
            <span className="mt-0.5 block text-subtle">
              {t("monitorForm.ignoreTlsHelp")}
            </span>
          </span>
        </label>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={values.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
          className="size-4 accent-[var(--brand)]"
        />
        {t("proxy.form.enabled")}
      </label>

      <div className="rounded-md border border-line">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex w-full items-center justify-between px-3 py-2 text-xs text-subtle transition-colors hover:text-ink"
        >
          <span>{t("monitorForm.customSchedule")}</span>
          <span>{showAdvanced ? t("appForm.hide") : t("appForm.show")}</span>
        </button>

        {showAdvanced && (
          <div className="grid gap-3 border-t border-line px-3 py-3 sm:grid-cols-2">
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
              <p className="text-[11px] text-subtle">
                {t("monitorForm.customHelp")}
              </p>
              <button
                type="button"
                onClick={() =>
                  onChange({
                    intervalSeconds: "",
                    timeoutSeconds: "",
                    retries: "",
                    downThreshold: "",
                  })
                }
                className="ml-auto shrink-0 text-[11px] text-brand underline transition-opacity hover:opacity-80"
              >
                {t("monitorForm.followGlobal")}
              </button>
            </div>
            {(
              [
                ["intervalSeconds", t("monitorForm.interval"), defaults.intervalSeconds],
                ["timeoutSeconds", t("monitorForm.timeout"), defaults.timeoutSeconds],
                ["retries", t("monitorForm.retries"), defaults.retries],
                ["downThreshold", t("monitorForm.downThreshold"), defaults.downThreshold],
              ] as const
            ).map(([key, label, fallback]) => (
              <Field
                key={key}
                label={label}
                help={values[key] === "" ? t("monitorForm.followingGlobal", { value: fallback }) : undefined}
              >
                <input
                  type="number"
                  value={values[key]}
                  onChange={(e) => onChange({ [key]: e.target.value })}
                  className={inputClass}
                />
              </Field>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:text-ink"
        >
          {t("common.actions.cancel")}
        </button>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity disabled:opacity-50"
        >
          {busy ? t("common.states.saving") : t("common.actions.save")}
        </button>
      </div>
    </form>
  );
}
