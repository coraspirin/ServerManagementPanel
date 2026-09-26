"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Copy, Download, Save } from "lucide-react";

import { readCsrfToken, Section } from "./shared";
import { CSRF_HEADER } from "@/lib/auth/types";
import type { Finding } from "@/lib/compose/checks";
import { useT } from "@/lib/i18n/client";
import { Rich } from "@/lib/i18n/rich";
import { copyText } from "@/lib/client/clipboard";

/**
 * Container'dan compose üretme sekmesi (M3.31).
 *
 * Compose'a ait OLMAYAN container'larda görünüyor: onlarda düzenlenecek bir
 * dosya yok ve panel bugüne kadar orada yalnızca bir özür metni gösteriyordu.
 * Bu sekme özrün yerine bir çıkış yolu koyuyor — dosyayı üretip yığın olarak
 * kaydeden kullanıcı, container'ı panelin geri kalanının yönetebildiği bir
 * şeye çeviriyor.
 */

type Payload = {
  yaml: string;
  serviceName: string;
  warnings: string[];
  findings: Finding[];
};

const SEVERITY_STYLE: Record<string, string> = {
  engel: "text-danger",
  uyari: "text-warn",
  oneri: "text-subtle",
};

export function GenerateTab({
  containerId,
  containerName,
  canInstall,
}: {
  containerId: string;
  containerName: string;
  /** `apps.install` izni — yoksa yalnızca kopyalama ve indirme sunuluyor. */
  canInstall: boolean;
}) {
  const t = useT();
  const [env, setEnv] = useState<"user" | "all">("user");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ ok: boolean; text: string } | null>(null);

  /*
    Yanıtı duruma yazan kısım effect'ten AYRI bir callback: setState'i effect
    gövdesinde doğrudan çağırmak zincirleme render üretiyor ve eslint kuralı
    haklı olarak buna izin vermiyor. Aynı desen dosya tarayıcıda da var.
  */
  const apply = useCallback((payload: Payload & { error?: string }, ok: boolean) => {
    if (ok) {
      setData(payload);
      setError(null);
    } else {
      setError(payload.error ?? t("docker.generate.failed"));
      setData(null);
    }
  }, [t]);

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        const response = await fetch(
          `/api/docker/${encodeURIComponent(containerId)}/compose/generate?env=${env}`,
          { signal: controller.signal, cache: "no-store" },
        );
        apply(await response.json(), response.ok);
      } catch (fetchError) {
        if ((fetchError as Error)?.name !== "AbortError") setError(t("common.errors.network"));
      }
    })();

    return () => controller.abort();
  }, [containerId, env, apply, t]);

  async function save() {
    if (!data) return;

    // Yığın adı servis adından öneriliyor ama kullanıcıya SORULUYOR: dizin adı
    // /opt/stacks altında kalıcı ve sonradan değiştirmek yığını taşımak demek.
    const name = prompt(t("docker.generate.stackPrompt"), data.serviceName);
    if (!name) return;

    setSaving(true);
    setSaveResult(null);
    try {
      const response = await fetch(
        `/api/docker/${encodeURIComponent(containerId)}/compose/generate`,
        {
          method: "POST",
          headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
          body: JSON.stringify({ name, compose: data.yaml }),
        },
      );
      const payload = (await response.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      setSaveResult(
        response.ok
          ? { ok: true, text: payload.message ?? t("docker.generate.installed") }
          : { ok: false, text: payload.error ?? t("docker.generate.installFailed") },
      );
    } catch {
      setSaveResult({ ok: false, text: t("common.errors.network") });
    } finally {
      setSaving(false);
    }
  }

  function download() {
    if (!data) return;
    const blob = new Blob([data.yaml], { type: "text/yaml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${data.serviceName}-compose.yml`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <Section title={t("docker.generate.title")}>
        <p className="text-xs text-subtle">
          <Rich
            text={t("docker.generate.intro")}
            values={{ name: <strong className="text-ink">{containerName}</strong> }}
          />
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-subtle">{t("docker.generate.envLabel")}</span>
          {(
            [
              ["user", t("docker.generate.envUser")],
              ["all", t("docker.generate.envAll")],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setEnv(id)}
              className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                env === id
                  ? "border-brand bg-brand/10 font-medium text-brand"
                  : "border-line text-subtle hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-subtle">
          {t("docker.generate.envNote")}
        </p>
      </Section>

      {error && <p className="text-sm text-danger">{error}</p>}
      {!error && !data && <p className="text-sm text-subtle">{t("docker.generate.generating")}</p>}

      {data && data.warnings.length > 0 && (
        <div className="rounded-lg border border-warn/40 bg-surface px-4 py-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-warn">
            <AlertTriangle className="size-3.5" aria-hidden />
            {t("docker.generate.warningsTitle")}
          </p>
          <ul className="mt-1.5 space-y-1 text-xs text-subtle">
            {data.warnings.map((entry) => (
              <li key={entry}>· {entry}</li>
            ))}
          </ul>
        </div>
      )}

      {data && data.findings.length > 0 && (
        <Section title={t("docker.generate.precheck")}>
          <ul className="space-y-1 text-xs">
            {data.findings.map((finding, index) => (
              <li key={`${finding.title}-${index}`} className={SEVERITY_STYLE[finding.severity]}>
                · <strong>{finding.title}</strong>
                {finding.line !== undefined && (
                  <span className="text-subtle"> {t("docker.generate.line", { line: finding.line })}</span>
                )}{" "}
                <span className="text-subtle">{finding.detail}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {data && (
        <Section
          title="docker-compose.yml"
          action={
            <div className="flex flex-wrap items-center gap-1.5">
              <SmallButton
                onClick={() => void copyText(data.yaml)}
                icon={<Copy className="size-3" />}
                label={t("common.actions.copy")}
              />
              <SmallButton
                onClick={download}
                icon={<Download className="size-3" />}
                label={t("docker.generate.download")}
              />
              {canInstall && (
                <SmallButton
                  onClick={() => void save()}
                  disabled={saving}
                  icon={<Save className="size-3" />}
                  label={saving ? t("docker.generate.installing") : t("docker.generate.saveAsStack")}
                />
              )}
            </div>
          }
        >
          <pre className="max-h-96 overflow-auto rounded-md border border-line bg-canvas p-3 font-mono text-[11px] leading-relaxed">
            {data.yaml}
          </pre>

          {saveResult && (
            <p className={`mt-2 text-xs ${saveResult.ok ? "text-ok" : "text-danger"}`}>
              {saveResult.text}
            </p>
          )}

          <p className="mt-2 text-[11px] text-subtle">
            <Rich
              text={t("docker.generate.saveNote")}
              values={{
                strong: <strong className="text-ink">{t("docker.generate.saveNoteStrong")}</strong>,
              }}
            />
          </p>
        </Section>
      )}
    </div>
  );
}

function SmallButton({
  onClick,
  icon,
  label,
  disabled,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-subtle transition-colors hover:border-brand hover:text-brand disabled:opacity-40"
    >
      {icon}
      {label}
    </button>
  );
}
