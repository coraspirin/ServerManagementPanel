"use client";

import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";

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
        setMessage(data.error ?? "İçe aktarım başarısız.");
        return;
      }

      const summary = Object.entries(data.applied ?? {})
        .filter(([, count]) => count > 0)
        .map(([key, count]) => `${key}: ${count}`)
        .join(" · ");

      setMessage(
        `Uygulandı — ${summary || "değişiklik yok"}.` +
          (data.skipped?.length ? ` Atlanan: ${data.skipped.length}.` : "") +
          " Gizli değerler (token/parola) dosyada taşınmaz; onları yeniden girmen gerekir.",
      );
    } catch {
      setFailed(true);
      setMessage("Sunucuya ulaşılamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <h2 className="text-sm font-semibold">Yapılandırma aktarımı</h2>
      <p className="mt-1 text-xs leading-snug text-subtle">
        Ayarlar, uygulama kartları, bookmark&apos;lar, monitörler, yayınlanan adresler ve
        Wake-on-LAN kayıtları tek bir JSON dosyasına yazılır.{" "}
        <strong>Gizli değerler dışarıda:</strong> şifreli veriler MASTER_KEY&apos;e bağlı ve o
        anahtar yedeğe girmiyor, dolayısıyla başka bir kurulumda çözülemezdi. Dosya bu yüzden düz
        metin olarak paylaşılabilir.
      </p>
      <p className="mt-2 text-xs text-subtle">
        İçe aktarım <strong>birleştirir</strong>: aynı ada sahip kayıt güncellenir, olmayan
        eklenir, dosyada olmayan hiçbir şey silinmez.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href="/api/backup/config"
          download
          className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand"
        >
          <Download className="size-4" /> Dışa aktar
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
          <Upload className="size-4" /> {busy ? "Uygulanıyor…" : "İçe aktar"}
        </button>
      </div>

      {message && (
        <p className={`mt-3 text-sm ${failed ? "text-danger" : "text-ok"}`}>{message}</p>
      )}
    </section>
  );
}
