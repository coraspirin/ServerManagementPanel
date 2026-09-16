"use client";

import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import { useT } from "@/lib/i18n/client";
import { Rich } from "@/lib/i18n/rich";

/**
 * M2.13 — yapılandırma dışa/içe aktarımı.
 *
 * İçe aktarım BİRLEŞTİRİR, silmez — ve bu düğmenin yanında yazıyor. "İçe
 * aktardım, her şeyim gitti" geri alınamaz bir hata olurdu ve kullanıcı
 * basmadan önce ne olacağını bilmeli.
 */

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

export function ConfigTransfer() {
  const t = useT();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function importFile(file: File) {
    setBusy(true);
    setFailed(false);
    setMessage(null);
    try {
      const response = await fetch("/api/backup/config", {
        method: "POST",
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: await file.text(),
      });
      const data = (await response.json()) as {
        error?: string;
        applied?: Record<string, number>;
        skipped?: string[];
      };

      if (!response.ok) {
        setFailed(true);
        setMessage(data.error ?? t("configTransfer.importFailed"));
        return;
      }

      const summary = Object.entries(data.applied ?? {})
        .filter(([, count]) => count > 0)
        .map(([key, count]) => `${key}: ${count}`)
        .join(" · ");

      setMessage(
        t("configTransfer.applied", { summary: summary || t("configTransfer.noChanges") }) +
          (data.skipped?.length ? t("configTransfer.skipped", { count: data.skipped.length }) : "") +
          t("configTransfer.secretsNote"),
      );
    } catch {
      setFailed(true);
      setMessage(t("common.errors.network"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <h2 className="text-sm font-semibold">{t("configTransfer.title")}</h2>
      <p className="mt-1 text-xs leading-snug text-subtle">
        <Rich
          text={t("configTransfer.intro")}
          values={{ strong: <strong>{t("configTransfer.secretsOut")}</strong> }}
        />
      </p>
      <p className="mt-2 text-xs text-subtle">
        <Rich
          text={t("configTransfer.merge")}
          values={{ strong: <strong>{t("configTransfer.mergeWord")}</strong> }}
        />
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href="/api/backup/config"
          download
          className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand"
        >
          <Download className="size-4" /> {t("configTransfer.export")}
        </a>

        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importFile(file);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand disabled:opacity-50"
        >
          <Upload className="size-4" />{" "}
          {busy ? t("configTransfer.applying") : t("configTransfer.import")}
        </button>
      </div>

      {message && (
        <p className={`mt-3 text-sm ${failed ? "text-danger" : "text-ok"}`}>{message}</p>
      )}
    </section>
  );
}
