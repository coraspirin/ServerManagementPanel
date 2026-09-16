"use client";

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { readCsrfToken } from "./detail/shared";
import { CSRF_HEADER } from "@/lib/auth/types";
import { specFromImage, type ContainerSpec } from "@/lib/docker/spec";
import { useT } from "@/lib/i18n/client";
import { Rich } from "@/lib/i18n/rich";

/**
 * Image çekme sekmesi (M3.46).
 *
 * ## Neden ayrı bir sekme
 *
 * Container kurmanın iki gerçek başlangıcı var: elinde bir compose dosyası
 * olması ya da yalnızca bir imaj adı bilmen. İkisini tek forma sıkıştırmak
 * ("YAML yapıştır VEYA image yaz") her iki kullanıcıya da diğerinin alanını
 * göstermek olurdu.
 *
 * ## Çekmek çalıştırmak değildir
 *
 * Pull bittiğinde container OLUŞMUYOR; imajın kendi yapılandırmasından
 * doldurulmuş bir form açılıyor ve karar kullanıcıda kalıyor. Bir imajı
 * indirmek onu çalıştırmak istediğin anlamına gelmiyor — sadece bakmak
 * isteyebilirsin.
 *
 * ## İlerleme neden satır satır
 *
 * 3 GB'lık bir imajda tek bir "çekiliyor…" yazısı dondu mu bilinmez. Uç
 * nokta SSE akıtıyor (aynı desen tek-tık güncellemede de var) ve son satır
 * ekranda duruyor; tamamı katlanabilir bir kutuda.
 */

export function ImagePullPanel({
  onReady,
}: {
  /** Çekme bitti — form bu spec ile açılacak. */
  onReady: (spec: ContainerSpec) => void;
}) {
  const t = useT();
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const logRef = useRef<HTMLPreElement>(null);

  // Yeni satır geldikçe kutu en alta kayıyor; kullanıcının ilerlemeyi elle
  // takip etmesi gerekmesin.
  useEffect(() => {
    const box = logRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [lines]);

  async function pull() {
    const target = reference.trim();
    if (!target) return;

    setBusy(true);
    setError(null);
    setLines([]);

    try {
      const response = await fetch("/api/docker/pull", {
        method: "POST",
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: JSON.stringify({ reference: target }),
      });

      // Yetki/mock gibi hatalar akıştan ÖNCE, düz JSON olarak geliyor.
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}) as { error?: string });
        setError(payload.error ?? t("docker.imagePull.failed"));
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // SSE çerçevesi boş satırla ayrılıyor; parçalı gelen bir çerçeveyi
      // ayrıştırmaya kalkmak "adim" olaylarını ikiye bölerdi.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const eventLine = frame.split("\n").find((line) => line.startsWith("event: "));
          const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
          if (!eventLine || !dataLine) continue;

          const event = eventLine.slice(7).trim();
          const data = JSON.parse(dataLine.slice(6));

          if (event === "adim") {
            setLines((prev) => [...prev.slice(-200), String(data)]);
          } else if (event === "hata") {
            setError(String((data as { message?: string }).message ?? t("docker.imagePull.failed")));
          } else if (event === "bitti") {
            const payload = data as { reference: string; inspect: unknown };
            onReady(specFromImage(payload.reference, payload.inspect));
          }
        }
      }
    } catch {
      setError(t("common.errors.network"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm">
        <span className="text-subtle">{t("docker.imagePull.name")}</span>
        <div className="mt-1 flex flex-wrap gap-2">
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) void pull();
            }}
            placeholder="nginx:alpine"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-3 py-1.5 font-mono text-sm outline-none focus:border-brand"
          />
          <button
            type="button"
            disabled={busy || reference.trim() === ""}
            onClick={() => void pull()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Download className="size-4" aria-hidden />
            {busy ? t("docker.imagePull.pulling") : t("docker.imagePull.pull")}
          </button>
        </div>
        <span className="mt-1 block text-xs text-subtle">
          <Rich
            text={t("docker.imagePull.help")}
            values={{
              latest: <code className="font-mono">latest</code>,
              example: <code className="font-mono">{t("docker.imagePull.example")}</code>,
            }}
          />
        </span>
      </label>

      {error && (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {lines.length > 0 && (
        <pre
          ref={logRef}
          className="max-h-56 overflow-auto rounded-md border border-line bg-canvas px-3 py-2 font-mono text-[11px] leading-relaxed text-subtle"
        >
          {lines.join("\n")}
        </pre>
      )}

      <p className="rounded-md bg-brand/5 px-3 py-2 text-xs leading-relaxed text-subtle">
        {t("docker.imagePull.note")}{" "}
        <strong>{t("docker.composeImport.onlyOnCreate")}</strong>
      </p>
    </div>
  );
}
