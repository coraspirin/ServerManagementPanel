"use client";

import { useRef, useState } from "react";
import { FileCode, Upload } from "lucide-react";
import { readCsrfToken } from "./detail/shared";
import { CSRF_HEADER } from "@/lib/auth/types";
import type { ContainerSpec } from "@/lib/docker/spec";
import { useT } from "@/lib/i18n/client";
import { Rich } from "@/lib/i18n/rich";

/**
 * Compose YAML ile container ekleme sekmesi (M3.46).
 *
 * ## Neden burada "kurulum" yok
 *
 * Bu panelin atası, YAML'ı host'a yazıp `docker compose up` çalıştıran yığın
 * kurulum ekranıydı. Kullanıcının istediği akış farklı: dosya eklenince
 * container AYRINTILARI formu açılsın, her alan düzenlenebilsin ve container
 * ancak "Konteyner oluştur" düğmesiyle var olsun. Burada olan tek şey
 * ayrıştırma — ne dosya yazılıyor, ne komut çalıştırılıyor.
 *
 * Çok servisli bir dosyada seçim SORULUYOR. Sessizce ilkini almak, üç servisli
 * bir yığında kullanıcının istemediği servisi açardı; hepsini birden
 * oluşturmak ise "hiçbir şey otomatik oluşmayacak" kuralını çiğnerdi.
 *
 * ## Compose yığını kurmak isteyen ne yapacak
 *
 * Birden çok servisi compose'un kendisiyle (tek `compose up`, ortak ağ,
 * bağımlılık sırası) ayağa kaldırmak ayrı bir iş ve yeri Stack sekmesi. Bu
 * form tek container üretir; ilişkili bir yığını buradan üç kez geçerek
 * kurmak compose'un çözdüğü sorunları geri getirir.
 */

/** Sunucudaki sınırla aynı sayı. */
const MAX_COMPOSE_BYTES = 256 * 1024;

type ImportedService = {
  service: string;
  spec: ContainerSpec;
  warnings: string[];
};

function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

export function ComposeImportPanel({
  onReady,
}: {
  /** Servis seçildi — form bu tanımla açılacak. */
  onReady: (spec: ContainerSpec, warnings: string[]) => void;
}) {
  const t = useT();
  const [compose, setCompose] = useState("");
  const [fileInfo, setFileInfo] = useState<{ name: string; size: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [services, setServices] = useState<ImportedService[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function parse(text: string) {
    setBusy(true);
    setError(null);
    setServices(null);

    try {
      const response = await fetch("/api/docker/from-compose", {
        method: "POST",
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: JSON.stringify({ compose: text }),
      });
      const payload = (await response.json()) as {
        services?: ImportedService[];
        error?: string;
      };

      if (!response.ok || !payload.services) {
        setError(payload.error ?? t("docker.composeImport.readFailed"));
        return;
      }

      // Tek servis varsa seçtirmenin anlamı yok: kullanıcının istediği akış
      // "dosyayı ekle, form açılsın".
      if (payload.services.length === 1) {
        const only = payload.services[0];
        onReady(only.spec, only.warnings);
        return;
      }

      setServices(payload.services);
    } catch {
      setError(t("common.errors.network"));
    } finally {
      setBusy(false);
    }
  }

  async function takeFile(file: File | undefined) {
    if (!file) return;
    setError(null);

    if (file.size > MAX_COMPOSE_BYTES) {
      setError(
        t("docker.composeImport.tooLarge", { name: file.name, size: formatSize(file.size) }),
      );
      return;
    }

    const text = await file.text();
    setCompose(text);
    setFileInfo({ name: file.name, size: file.size });
    await parse(text);
  }

  function clearFile() {
    setCompose("");
    setFileInfo(null);
    setServices(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void takeFile(e.dataTransfer.files[0]);
        }}
        className={`flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors ${
          dragging ? "border-brand bg-brand/5" : "border-line"
        }`}
      >
        <Upload className="size-6 text-subtle" aria-hidden />
        <p className="text-sm text-subtle">
          <Rich
            text={t("docker.composeImport.dropHere")}
            values={{ file: <code className="font-mono">docker-compose.yml</code> }}
          />
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".yml,.yaml,text/yaml,text/plain"
          onChange={(e) => void takeFile(e.target.files?.[0])}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand"
        >
          {t("docker.composeImport.chooseFile")}
        </button>
        {fileInfo && (
          <p className="text-xs text-subtle">
            <span className="font-mono">{fileInfo.name}</span> · {formatSize(fileInfo.size)}
            <button
              type="button"
              onClick={clearFile}
              className="ml-2 underline transition-colors hover:text-ink"
            >
              {t("docker.composeImport.clear")}
            </button>
          </p>
        )}
      </div>

      {/*
        Yapıştırma kutusu dosya seçicinin ALTERNATİFİ, süsü değil: compose
        parçaları çoğu zaman bir depo sayfasından kopyalanıyor ve o metni
        önce dosyaya kaydettirmek gereksiz bir adım.
      */}
      <label className="block text-sm">
        <span className="text-subtle">{t("docker.composeImport.orPaste")}</span>
        <textarea
          value={compose}
          onChange={(e) => {
            setCompose(e.target.value);
            setServices(null);
          }}
          rows={8}
          spellCheck={false}
          placeholder={t("docker.composeImport.placeholder")}
          className="mt-1 w-full resize-y rounded-md border border-line bg-canvas px-3 py-2 font-mono text-[12px] leading-relaxed outline-none focus:border-brand"
        />
      </label>

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          disabled={busy || compose.trim() === ""}
          onClick={() => void parse(compose)}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <FileCode className="size-4" aria-hidden />
          {busy ? t("docker.composeImport.reading") : t("docker.composeImport.readServices")}
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="whitespace-pre-wrap rounded-md bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      )}

      {services && services.length > 1 && (
        <section className="rounded-md border border-line">
          <p className="border-b border-line px-3 py-2 text-xs text-subtle">
            {t("docker.composeImport.pickService", { count: services.length })}
          </p>
          <ul className="divide-y divide-line">
            {services.map((entry) => (
              <li key={entry.service}>
                <button
                  type="button"
                  onClick={() => onReady(entry.spec, entry.warnings)}
                  className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-2 text-left transition-colors hover:bg-line/40"
                >
                  <span className="font-medium">{entry.service}</span>
                  <span className="truncate font-mono text-[11px] text-subtle">
                    {entry.spec.image || t("docker.composeImport.noImage")}
                  </span>
                  {entry.warnings.length > 0 && (
                    <span className="ml-auto text-[11px] text-warn">
                      {t("docker.composeImport.warnings", { count: entry.warnings.length })}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="rounded-md bg-brand/5 px-3 py-2 text-xs leading-relaxed text-subtle">
        <Rich
          text={t("docker.composeImport.note")}
          values={{
            cmd: <code className="font-mono">compose up</code>,
            strong: <strong>{t("docker.composeImport.onlyOnCreate")}</strong>,
          }}
        />
      </p>
    </div>
  );
}
