"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Copy, Download, Save } from "lucide-react";

import { readCsrfToken, Section } from "./shared";
import { CSRF_HEADER } from "@/lib/auth/types";
import type { Finding } from "@/lib/compose/checks";

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
      setError(payload.error ?? "Compose üretilemedi.");
      setData(null);
    }
  }, []);

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
        if ((fetchError as Error)?.name !== "AbortError") setError("Sunucuya ulaşılamadı.");
      }
    })();

    return () => controller.abort();
  }, [containerId, env, apply]);

  async function save() {
    if (!data) return;

    // Yığın adı servis adından öneriliyor ama kullanıcıya SORULUYOR: dizin adı
    // /opt/stacks altında kalıcı ve sonradan değiştirmek yığını taşımak demek.
    const name = prompt(
      "Yığın adı (küçük harf, rakam ve tire):\n\n" +
        "Dosya /opt/stacks/<ad>/docker-compose.yml olarak yazılır ve `compose up` çalıştırılır. " +
        "Var olan bir dizinin üzerine ASLA yazılmaz.",
      data.serviceName,
    );
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
          ? { ok: true, text: payload.message ?? "Yığın kuruldu." }
          : { ok: false, text: payload.error ?? "Kurulum başarısız." },
      );
    } catch {
      setSaveResult({ ok: false, text: "Sunucuya ulaşılamadı." });
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
      <Section title="Compose üret">
        <p className="text-xs text-subtle">
          <strong className="text-ink">{containerName}</strong> bir compose yığınına ait değil,
          bu yüzden düzenlenecek bir dosyası yok. Aşağıdaki dosya container&apos;ın şu anki
          yapılandırmasından üretildi; yığın olarak kaydedersen port, ağ ve ortam
          düzenleyicileri bu container için de açılır.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-subtle">Ortam değişkenleri:</span>
          {(
            [
              ["user", "Yalnızca kendi verdiklerim"],
              ["all", "Hepsi (imajınkiler dahil)"],
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
          &quot;Hepsi&quot; imajın kendi varsayılanlarını da dosyaya yazar. Bu değerler imaj
          güncellendiğinde eskide donar — gerçekten gerekmedikçe ilk seçenek doğru olan.
        </p>
      </Section>

      {error && <p className="text-sm text-danger">{error}</p>}
      {!error && !data && <p className="text-sm text-subtle">üretiliyor…</p>}

      {data && data.warnings.length > 0 && (
        <div className="rounded-lg border border-warn/40 bg-surface px-4 py-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-warn">
            <AlertTriangle className="size-3.5" aria-hidden />
            Taşınamayan ya da dikkat isteyen şeyler
          </p>
          <ul className="mt-1.5 space-y-1 text-xs text-subtle">
            {data.warnings.map((entry) => (
              <li key={entry}>· {entry}</li>
            ))}
          </ul>
        </div>
      )}

      {data && data.findings.length > 0 && (
        <Section title="Ön kontrol">
          <ul className="space-y-1 text-xs">
            {data.findings.map((finding, index) => (
              <li key={`${finding.title}-${index}`} className={SEVERITY_STYLE[finding.severity]}>
                · <strong>{finding.title}</strong>
                {finding.line !== undefined && (
                  <span className="text-subtle"> (satır {finding.line})</span>
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
                onClick={() => void navigator.clipboard?.writeText(data.yaml)}
                icon={<Copy className="size-3" />}
                label="Kopyala"
              />
              <SmallButton
                onClick={download}
                icon={<Download className="size-3" />}
                label="İndir"
              />
              {canInstall && (
                <SmallButton
                  onClick={() => void save()}
                  disabled={saving}
                  icon={<Save className="size-3" />}
                  label={saving ? "kuruluyor…" : "Yığın olarak kaydet"}
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
            Kaydetmek yeni bir yığın kurar; <strong className="text-ink">bu container&apos;ı
            kaldırmaz</strong>. İkisi aynı portu dinlediği için yeni yığın önce hata verir —
            eskisini durdurup sonra kurmak ya da üretilen dosyada portu değiştirmek gerekiyor.
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
