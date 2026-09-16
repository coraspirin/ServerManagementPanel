"use client";

import { useRef, useState } from "react";
import { ImageUp, Trash2 } from "lucide-react";
import {
  cardColor,
  iconSource,
  initials,
  HOST_PLACEHOLDER,
  type AppCard,
  type AppCategory,
} from "@/lib/apps/types";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import type { WidgetDef } from "@/lib/widgets/types";
import { useT } from "@/lib/i18n/client";
import { Rich } from "@/lib/i18n/rich";

/**
 * Kart ekleme/düzenleme formu (M2.2).
 *
 * Üstte yalnızca üç alan var (ad, adres, kategori) — bir kısayol eklemek beş
 * saniyelik bir iş olmalı. Panelin kendi erişim adresi, container bağı ve
 * durum izleyicisi "gelişmiş" bölümünde: hepsi gerçek ihtiyaç ama hiçbiri ilk
 * kart eklenirken sorulmamalı.
 */

export type AppFormValues = {
  name: string;
  url: string;
  description: string;
  categoryId: string;
  icon: string;
  color: string;
  internalUrl: string;
  containerName: string;
  monitorId: string;
  openNewTab: boolean;
  enabled: boolean;
  showOnLogin: boolean;
  widgetType: string;
  /** Gizli alanlar boş gelir; boş bırakılırsa kayıtlı değer korunur (M2.6). */
  widgetConfig: Record<string, string>;
};

export function emptyAppForm(): AppFormValues {
  return {
    name: "",
    url: "",
    description: "",
    categoryId: "",
    icon: "",
    color: "",
    internalUrl: "",
    containerName: "",
    monitorId: "",
    openNewTab: true,
    enabled: true,
    // Varsayılan kapalı: bir kartı dışarı açmak bilinçli bir karar olmalı.
    showOnLogin: false,
    widgetType: "",
    widgetConfig: {},
  };
}

export function appToForm(card: AppCard): AppFormValues {
  return {
    name: card.name,
    url: card.url,
    description: card.description,
    categoryId: card.categoryId?.toString() ?? "",
    icon: card.icon,
    color: card.color,
    internalUrl: card.internalUrl,
    containerName: card.containerName,
    monitorId: card.monitorId?.toString() ?? "",
    openNewTab: card.openNewTab,
    enabled: card.enabled,
    showOnLogin: card.showOnLogin,
    widgetType: card.widgetType,
    widgetConfig: {},
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

/** Formdaki canlı logo önizlemesi — kaydetmeden ne görüneceğini gösterir. */
function LogoPreview({ values }: { values: AppFormValues }) {
  const card = { icon: values.icon, url: values.url, name: values.name || "?", color: values.color };
  const source = iconSource(card);
  const [broken, setBroken] = useState(false);

  if (source.kind === "initials" || broken) {
    return (
      <span
        aria-hidden
        style={{ backgroundColor: cardColor(card) }}
        className="flex size-11 shrink-0 items-center justify-center rounded-md text-base font-semibold text-white"
      >
        {source.kind === "initials" ? source.text : initials(card.name)}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- bkz. AppTile
    <img
      // `key` şart: aynı <img> öğesinde src değişince React `broken` durumunu
      // korur ve yeni adres denenmeden kırık sayılırdı.
      key={source.src}
      src={source.src}
      alt=""
      width={44}
      height={44}
      onError={() => setBroken(true)}
      className="size-11 shrink-0 rounded-md object-contain"
    />
  );
}

export type MonitorOption = { id: number; name: string };
export type ContainerOption = { name: string; ports: number[] };

/**
 * Container seçilince forma uygulanacak değişiklik.
 *
 * YALNIZCA BOŞ alanlar dolduruluyor. Kullanıcının yazdığı bir adresi container
 * seçimi yüzünden ezmek, formun en kötü sürprizi olurdu — özellikle mevcut bir
 * kartı düzenlerken.
 *
 * Adres `{host}` yer tutucusuyla kuruluyor: panel, kullanıcının paneli hangi
 * adresle açtığını bilemez (evden LAN IP'si, dışarıdan alan adı, tailnet
 * üzerinden 100.x). Yer tutucu isteği karşılayan sunucuda çözülüyor — keşif
 * turunun kartları da aynı biçimde kuruluyor (bkz. apps/discovery.ts).
 */
function containerPatch(
  secim: string,
  containers: ContainerOption[],
  values: AppFormValues,
): Partial<AppFormValues> {
  // "listede yok" seçeneği: kayıtlı adı olduğu gibi bırak.
  if (secim === "__elle") return {};
  if (secim === "") return { containerName: "" };

  const patch: Partial<AppFormValues> = { containerName: secim };
  if (!values.name.trim()) patch.name = secim;

  const port = containers.find((entry) => entry.name === secim)?.ports[0];
  if (port !== undefined && !values.url.trim()) {
    patch.url = `http://${HOST_PLACEHOLDER}:${port}`;
  }

  return patch;
}

export function AppForm({
  values,
  categories,
  monitors,
  containers,
  widgets,
  widgetConfigured = false,
  busy,
  error,
  discovered = false,
  onChange,
  onSubmit,
  onCancel,
  onDelete,
}: {
  values: AppFormValues;
  categories: AppCategory[];
  monitors: MonitorOption[];
  /** Docker'daki container'lar; boş gelirse alan serbest metne düşer. */
  containers: ContainerOption[];
  widgets: WidgetDef[];
  /** Kayıtlı bir widget yapılandırması var mı (M2.6). */
  widgetConfigured?: boolean;
  busy: boolean;
  error: string | null;
  /** Kart Docker etiketlerinden geldi mi (M2.5). */
  discovered?: boolean;
  onChange: (patch: Partial<AppFormValues>) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const t = useT();
  const [showAdvanced, setShowAdvanced] = useState(
    values.internalUrl !== "" ||
      values.containerName !== "" ||
      values.monitorId !== "" ||
      // Kart dışarı açıksa bu kapalı bir kutunun ardında saklanmamalı:
      // düzenlemeye gelen kişi durumu görmeden kaydedebilirdi.
      values.showOnLogin,
  );
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [initialWidget] = useState(values.widgetType);

  const widgetDef = widgets.find((widget) => widget.key === values.widgetType);
  // Tür değiştirildiyse kayıtlı gizli değer artık geçerli değil; "kayıtlı"
  // yazmak kullanıcıya parolayı yeniden girmesi gerekmediğini düşündürürdü.
  const sameWidget = values.widgetType === initialWidget;

  async function upload(file: File) {
    setUploadError(null);
    const form = new FormData();
    form.append("file", file);

    try {
      const response = await fetch("/api/apps/logo", {
        method: "POST",
        // CSRF başlığı burada da gerekiyor; FormData gönderirken content-type
        // ELLE yazılmamalı, tarayıcı boundary'yi kendisi ekler.
        headers: { [CSRF_HEADER]: readCsrf() },
        body: form,
      });
      const data = (await response.json()) as { icon?: string; error?: string };
      if (!response.ok) {
        setUploadError(data.error ?? t("appForm.logoFailed"));
        return;
      }
      onChange({ icon: data.icon ?? "" });
    } catch {
      setUploadError(t("common.errors.network"));
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {discovered && (
        <p className="rounded-md border border-brand/40 bg-brand/5 px-3 py-2 text-xs">
          <Rich
            text={t("appForm.discovered")}
            values={{
              container: <span className="font-medium">{values.containerName}</span>,
              yours: <span className="font-medium">{t("appForm.yours")}</span>,
            }}
          />
        </p>
      )}

      <div className="flex items-start gap-3">
        <LogoPreview values={values} />
        <div className="min-w-0 flex-1 space-y-3">
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
          <Field
            label={t("appForm.address")}
            help={t("appForm.addressHelp")}
          >
            <input
              type="text"
              value={values.url}
              onChange={(e) => onChange({ url: e.target.value })}
              placeholder="http://192.168.61.114:8123"
              className={`font-mono ${inputClass}`}
            />
          </Field>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("appForm.category")}>
          <select
            value={values.categoryId}
            onChange={(e) => onChange({ categoryId: e.target.value })}
            className={inputClass}
          >
            <option value="">{t("appForm.uncategorized")}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("appForm.description")} help={t("appForm.descriptionHelp")}>
          <input
            type="text"
            value={values.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder={t("appForm.descriptionPlaceholder")}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="rounded-md border border-line px-3 py-2.5">
        <span className="text-xs font-medium">{t("appForm.logo")}</span>
        <p className="mt-0.5 text-[11px] leading-snug text-subtle">
          {t("appForm.logoHelp")}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/x-icon"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              // Aynı dosya ikinci kez seçilebilsin diye alan sıfırlanıyor.
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs transition-colors hover:border-brand"
          >
            <ImageUp className="size-3.5" /> {t("appForm.uploadFile")}
          </button>

          {values.icon && (
            <button
              type="button"
              onClick={() => onChange({ icon: "" })}
              className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs text-subtle transition-colors hover:text-danger"
            >
              <Trash2 className="size-3.5" /> {t("appForm.remove")}
            </button>
          )}

          <label className="ml-auto flex items-center gap-1.5 text-xs text-subtle">
            {t("appForm.color")}
            <input
              type="color"
              // Renk seçicinin boş değeri yok; kullanıcı hiç dokunmadıysa
              // türetilmiş renk gösteriliyor ki seçici doğru yerden başlasın.
              value={cardColor({ color: values.color, name: values.name })}
              onChange={(e) => onChange({ color: e.target.value })}
              className="size-7 cursor-pointer rounded border border-line bg-canvas"
            />
          </label>
        </div>

        {uploadError && <p className="mt-2 text-xs text-danger">{uploadError}</p>}
      </div>

      <div className="rounded-md border border-line px-3 py-2.5">
        <label className="block">
          <span className="text-xs font-medium">{t("appForm.widget")}</span>
          <select
            value={values.widgetType}
            onChange={(e) =>
              // Tür değişince eski alanlar temizleniyor: farklı bir servisin
              // alanları yeni widget'a taşınmamalı.
              onChange({ widgetType: e.target.value, widgetConfig: {} })
            }
            className={`mt-1 ${inputClass}`}
          >
            <option value="">{t("appForm.noWidget")}</option>
            {widgets.map((widget) => (
              <option key={widget.key} value={widget.key}>
                {widget.label}
              </option>
            ))}
          </select>
        </label>

        {widgetDef && (
          <div className="mt-3 space-y-3 border-t border-line pt-3">
            <p className="text-[11px] leading-snug text-subtle">{widgetDef.help}</p>

            {widgetDef.fields.map((field) => (
              <Field key={field.key} label={field.label} help={field.help}>
                <input
                  type={field.type === "secret" ? "password" : "text"}
                  value={values.widgetConfig[field.key] ?? ""}
                  onChange={(e) =>
                    onChange({
                      widgetConfig: { ...values.widgetConfig, [field.key]: e.target.value },
                    })
                  }
                  placeholder={
                    field.type === "secret" && widgetConfigured && sameWidget
                      ? t("appForm.secretSaved")
                      : field.placeholder
                  }
                  className={inputClass}
                />
              </Field>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-md border border-line">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex w-full items-center justify-between px-3 py-2 text-xs text-subtle transition-colors hover:text-ink"
        >
          <span>{t("appForm.advanced")}</span>
          <span>{showAdvanced ? t("appForm.hide") : t("appForm.show")}</span>
        </button>

        {showAdvanced && (
          <div className="space-y-3 border-t border-line px-3 py-3">
            <Field
              label={t("appForm.internalUrl")}
              help={t("appForm.internalUrlHelp")}
            >
              <input
                type="text"
                value={values.internalUrl}
                onChange={(e) => onChange({ internalUrl: e.target.value })}
                placeholder={t("appForm.internalUrlPlaceholder")}
                className={`font-mono ${inputClass}`}
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={t("appForm.container")}
                help={
                  containers.length > 0
                    ? t("appForm.containerHelp")
                    : t("appForm.containerHelpManual")
                }
              >
                {containers.length > 0 ? (
                  <select
                    value={
                      // Kayıtlı ad listede yoksa (container silinmiş ya da
                      // elle yazılmış olabilir) seçim boşa düşmesin diye
                      // "diğer" seçeneği tutuluyor.
                      containers.some((entry) => entry.name === values.containerName)
                        ? values.containerName
                        : values.containerName
                          ? "__elle"
                          : ""
                    }
                    onChange={(e) => onChange(containerPatch(e.target.value, containers, values))}
                    className={`font-mono ${inputClass}`}
                  >
                    <option value="">{t("appForm.notLinked")}</option>
                    {containers.map((entry) => (
                      <option key={entry.name} value={entry.name}>
                        {entry.name}
                        {entry.ports.length > 0 ? ` · :${entry.ports.join(", :")}` : ""}
                      </option>
                    ))}
                    {values.containerName &&
                      !containers.some((entry) => entry.name === values.containerName) && (
                        <option value="__elle">
                          {t("appForm.notInList", { name: values.containerName })}
                        </option>
                      )}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={values.containerName}
                    onChange={(e) => onChange({ containerName: e.target.value })}
                    placeholder="homeassistant"
                    className={`font-mono ${inputClass}`}
                  />
                )}
              </Field>

              <Field
                label={t("appForm.monitor")}
                help={t("appForm.monitorHelp")}
              >
                <select
                  value={values.monitorId}
                  onChange={(e) => onChange({ monitorId: e.target.value })}
                  className={inputClass}
                >
                  <option value="">{t("appForm.notLinked")}</option>
                  {monitors.map((monitor) => (
                    <option key={monitor.id} value={monitor.id}>
                      {monitor.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={values.openNewTab}
                onChange={(e) => onChange({ openNewTab: e.target.checked })}
                className="size-4 accent-[var(--brand)]"
              />
              {t("appForm.newTab")}
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={values.enabled}
                onChange={(e) => onChange({ enabled: e.target.checked })}
                className="size-4 accent-[var(--brand)]"
              />
              {t("proxy.form.enabled")}
            </label>

            <div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={values.showOnLogin}
                  onChange={(e) => onChange({ showOnLogin: e.target.checked })}
                  className="size-4 accent-[var(--brand)]"
                />
                {t("appForm.showOnLogin")}
              </label>
              <p className="mt-1 text-[11px] leading-snug text-subtle">
                {t("appForm.showOnLoginHelp")}
              </p>
            </div>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex items-center justify-end gap-2 pt-1">
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="mr-auto flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:border-danger hover:text-danger disabled:opacity-50"
          >
            <Trash2 className="size-4" /> {t("common.actions.delete")}
          </button>
        )}
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

function readCsrf(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}
