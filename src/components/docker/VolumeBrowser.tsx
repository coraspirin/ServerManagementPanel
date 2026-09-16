"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Download, File as FileIcon, Folder, Home, Link2 } from "lucide-react";

import { formatBytes } from "@/lib/metrics/catalog";
import type { FileEntry } from "@/lib/docker/listing";
import { useT } from "@/lib/i18n/client";
import { Rich } from "@/lib/i18n/rich";

/**
 * Volume içi dosya tarayıcı (M3.44).
 *
 * İlk sürüm (M3.40) yalnızca kök dizini listeliyordu — bu bilinçli bir sınırdı
 * ama pratikte yetmedi: bir volume'ün ne taşıdığını anlamak için neredeyse her
 * zaman bir alt dizine girmek gerekiyor (`/data/db`, `/config`…). Artık
 * gezinilebilir ve dosyalar indirilebiliyor.
 *
 * Container dosya tarayıcısıyla (M3.23) aynı davranış ve aynı `parseListing`
 * çıktısı; ayrı bir bileşen olmasının sebebi veri yolunun farklı olması —
 * container'da `exec`, volume'de tek seferlik bir container.
 *
 * ⚠️ **Salt okunur.** Yazma bilerek yok: volume, container'ın dosya
 * sisteminden farklı olarak KALICI veri ve çoğu zaman bir veritabanının canlı
 * dosyaları. Çalışan bir Postgres'in altından dosya düzenlemek, kurtarılamayan
 * bir bozulma demek. İçeriği değiştirmek gerekiyorsa doğru yol container'ın
 * kendi dosya sekmesi (uygulama orada dosyayı kilitliyor ve tutarlılığı
 * biliyor).
 */

type Listing = { ok: true; path: string; entries: FileEntry[] } | { ok: false; message: string };

export function VolumeBrowser({ volume, canAct }: { volume: string; canAct: boolean }) {
  const t = useT();
  const [cwd, setCwd] = useState("/");
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /*
    Durum yazan her şey effect'ten AYRI bir callback'te: setState'i effect
    gövdesinde doğrudan çağırmak zincirleme render üretiyor ve eslint kuralı
    buna izin vermiyor. Aynı desen dosya tarayıcıda ve compose üretme
    sekmesinde de var.
  */
  const apply = useCallback((payload: Listing | null) => {
    if (payload === null) {
      setBusy(true);
      return;
    }
    setBusy(false);
    if (payload.ok) {
      setEntries(payload.entries);
      setError(null);
    } else {
      setError(payload.message);
      setEntries(null);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      apply(null);
      try {
        const response = await fetch(
          `/api/docker/resources?detail=volume-files&id=${encodeURIComponent(volume)}&path=${encodeURIComponent(cwd)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const payload = (await response.json()) as Listing;
        if (!controller.signal.aborted) apply(payload);
      } catch (fetchError) {
        if ((fetchError as Error)?.name !== "AbortError") {
          apply({ ok: false, message: t("common.errors.network") });
        }
      }
    })();

    return () => controller.abort();
  }, [volume, cwd, apply, t]);

  // Kırıntı yolu: her parça tıklanabilir, böylece üç dizin yukarı çıkmak için
  // "yukarı" düğmesine üç kez basmak gerekmiyor.
  const parcalar = cwd === "/" ? [] : cwd.slice(1).split("/");

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <button
          type="button"
          onClick={() => setCwd("/")}
          className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-subtle transition-colors hover:text-brand"
        >
          <Home className="size-3" aria-hidden />
          {volume}
        </button>

        {parcalar.map((parca, index) => (
          <span key={`${parca}-${index}`} className="flex items-center gap-1">
            <ChevronRight className="size-3 text-subtle" aria-hidden />
            <button
              type="button"
              onClick={() => setCwd("/" + parcalar.slice(0, index + 1).join("/"))}
              className="rounded px-1 py-0.5 font-mono transition-colors hover:text-brand"
            >
              {parca}
            </button>
          </span>
        ))}

        {busy && <span className="ml-2 text-subtle">{t("common.states.loadingInline")}</span>}
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      {entries && (
        <div className="max-h-72 overflow-auto rounded-md border border-line">
          {entries.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-subtle">{t("docker.files.emptyDir")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {entries.map((entry) => {
                const dizin = entry.type === "dizin";
                const bag = entry.type === "sembolik";

                return (
                  <li
                    key={entry.path}
                    className="flex items-center gap-2 px-3 py-1.5 text-[11px] hover:bg-line/30"
                  >
                    {dizin ? (
                      <Folder className="size-3.5 shrink-0 text-brand" aria-hidden />
                    ) : bag ? (
                      <Link2 className="size-3.5 shrink-0 text-subtle" aria-hidden />
                    ) : (
                      <FileIcon className="size-3.5 shrink-0 text-subtle" aria-hidden />
                    )}

                    {dizin ? (
                      <button
                        type="button"
                        onClick={() => setCwd(entry.path)}
                        className="min-w-0 flex-1 truncate text-left font-mono transition-colors hover:text-brand"
                      >
                        {entry.name}
                      </button>
                    ) : (
                      <span className="min-w-0 flex-1 truncate font-mono" title={entry.name}>
                        {entry.name}
                        {bag && entry.linkTarget && (
                          <span className="text-subtle"> → {entry.linkTarget}</span>
                        )}
                      </span>
                    )}

                    <span className="shrink-0 font-mono text-subtle">{entry.permissions}</span>
                    <span className="w-24 shrink-0 truncate text-subtle" title={entry.owner}>
                      {entry.owner}
                    </span>
                    <span className="w-16 shrink-0 text-right font-mono text-subtle">
                      {entry.type === "dosya" ? formatBytes(entry.size) : "—"}
                    </span>

                    {/*
                      İndirme bir `<a>`: tarayıcının indirme akışına bağlanmanın
                      tek yolu bu. Yalnızca gerçek dosyalarda — dizin ve
                      sembolik bağda indirilecek bir gövde yok.
                    */}
                    {canAct && entry.type === "dosya" ? (
                      <a
                        href={`/api/docker/resources?detail=volume-file&id=${encodeURIComponent(volume)}&path=${encodeURIComponent(entry.path)}`}
                        title={t("docker.volumeBrowser.download", { name: entry.name })}
                        aria-label={t("docker.volumeBrowser.download", { name: entry.name })}
                        className="shrink-0 rounded p-1 text-subtle transition-colors hover:text-brand"
                      >
                        <Download className="size-3" aria-hidden />
                      </a>
                    ) : (
                      <span className="w-5 shrink-0" />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <p className="text-[11px] text-subtle">
        <Rich
          text={t("docker.volumeBrowser.note")}
          values={{ tab: <strong>{t("docker.drawer.tab.dosyalar")}</strong> }}
        />
      </p>
    </div>
  );
}
