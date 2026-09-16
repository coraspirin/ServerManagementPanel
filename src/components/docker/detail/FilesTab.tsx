"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronRight,
  Download,
  File as FileIcon,
  Folder,
  Home,
  Link2,
  RotateCw,
  Save,
  Upload,
  X,
} from "lucide-react";

import { CSRF_HEADER } from "@/lib/auth/types";
import type { FileEntry } from "@/lib/docker/listing";
import { useT } from "@/lib/i18n/client";
import { Rich } from "@/lib/i18n/rich";

import { bytes, readCsrfToken, Section } from "./shared";

/**
 * Container içi dosya tarayıcı (M3.23).
 *
 * Panelin dosya yöneticisi host'un dosyalarını geziyordu; container'ın içi
 * kapalıydı ve bir uygulamanın yapılandırmasını düzeltmenin tek yolu terminale
 * girip `vi` ile uğraşmaktı.
 *
 * ⚠️ Yazma işlemleri `docker.action` istiyor ve denetim kaydına giriyor:
 * bir container'ın dosyasını değiştirmek o uygulamayı ele geçirmekle aynı şey.
 * `canAct` yoksa yazma düğmeleri GİZLENMİYOR, hiç render edilmiyor.
 */
export function FilesTab({
  containerId,
  canAct,
}: {
  containerId: string;
  canAct: boolean;
}) {
  const t = useT();
  const [cwd, setCwd] = useState("/");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [maxBytes, setMaxBytes] = useState(0);
  const [yazmaKapali, setYazmaKapali] = useState(false);
  const [editing, setEditing] = useState<{
    path: string;
    text: string;
    original: string;
    binary: boolean;
    size: number;
  } | null>(null);

  const base = `/api/docker/${encodeURIComponent(containerId)}/files`;

  /**
   * Listeyi state'e dağıtan tek yer — efekt ile "yenile" düğmesi paylaşsın diye.
   *
   * `setBusy` BİLEREK burada değil: efektin gövdesinde senkron çalışan bir
   * setState, React'in kuralını ihlal ediyor (panelin diğer ekranlarında da
   * aynı kalıp). Meşguliyet göstergesini yalnızca elle yenilemede kuruyoruz.
   */
  const apply = useCallback((payload: Record<string, unknown>, ok: boolean) => {
    if (!ok || payload.ok === false) {
      setError((payload.error as string) ?? t("docker.files.dirFailed"));
      setEntries([]);
      return;
    }
    setError(null);
    setEntries(payload.entries as FileEntry[]);
    setMaxBytes((payload.maxBytes as number) ?? 0);
    setYazmaKapali(Boolean(payload.writeBlocked));
  }, [t]);

  const load = useCallback(
    async (target: string) => {
      setBusy(true);
      try {
        const response = await fetch(`${base}?mode=list&path=${encodeURIComponent(target)}`, {
          cache: "no-store",
        });
        apply(await response.json(), response.ok);
      } catch {
        setError(t("common.errors.network"));
      } finally {
        setBusy(false);
      }
    },
    [base, apply, t],
  );

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        const response = await fetch(`${base}?mode=list&path=${encodeURIComponent(cwd)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        apply(await response.json(), response.ok);
      } catch (fetchError) {
        if ((fetchError as Error)?.name !== "AbortError") setError(t("common.errors.network"));
      }
    })();

    return () => controller.abort();
  }, [base, cwd, apply, t]);

  async function ac(entry: FileEntry) {
    setNotice(null);
    try {
      const response = await fetch(`${base}?mode=text&path=${encodeURIComponent(entry.path)}`, {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? t("docker.files.openFailed"));
        return;
      }
      setError(null);
      setEditing({
        path: entry.path,
        text: payload.text,
        original: payload.text,
        binary: payload.binary,
        size: payload.size,
      });
    } catch {
      setError(t("common.errors.network"));
    }
  }

  async function kaydet() {
    if (!editing) return;
    setBusy(true);
    try {
      const response = await fetch(base, {
        method: "PUT",
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: JSON.stringify({ path: editing.path, text: editing.text }),
      });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) {
        setError(payload.error ?? t("common.errors.notSaved"));
        return;
      }
      setError(null);
      setNotice(t("docker.files.written", { path: editing.path }));
      setEditing({ ...editing, original: editing.text });
      await load(cwd);
    } catch {
      setError(t("common.errors.network"));
    } finally {
      setBusy(false);
    }
  }

  async function yukle(file: File) {
    if (maxBytes > 0 && file.size > maxBytes) {
      setError(
        t("docker.files.tooLarge", {
          name: file.name,
          limit: Math.round(maxBytes / 1024),
          size: file.size,
        }),
      );
      return;
    }

    setBusy(true);
    try {
      const buffer = await file.arrayBuffer();
      // Dosya JSON gövdesinde base64 olarak gidiyor: panelin diğer uçlarıyla
      // aynı CSRF ve izin yolunu paylaşsın diye. Boyut zaten sınırlı.
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));

      const response = await fetch(base, {
        method: "PUT",
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: JSON.stringify({ path: `${cwd === "/" ? "" : cwd}/${file.name}`, base64 }),
      });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) {
        setError(payload.error ?? t("docker.files.uploadFailed"));
        return;
      }
      setError(null);
      setNotice(t("docker.files.uploaded", { name: file.name }));
      await load(cwd);
    } catch {
      setError(t("docker.files.readFailed"));
    } finally {
      setBusy(false);
    }
  }

  const parcalar = cwd.split("/").filter(Boolean);

  return (
    <Section
      title={t("docker.files.title")}
      action={
        <button
          type="button"
          onClick={() => void load(cwd)}
          disabled={busy}
          title={t("common.actions.refresh")}
          className="rounded border border-line p-1.5 text-subtle transition-colors hover:text-brand disabled:opacity-50"
        >
          <RotateCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} />
        </button>
      }
    >
      <nav className="mb-2 flex flex-wrap items-center gap-0.5 text-xs">
        <button
          type="button"
          onClick={() => setCwd("/")}
          className="rounded p-1 text-subtle transition-colors hover:text-brand"
          title={t("docker.files.root")}
        >
          <Home className="size-3.5" />
        </button>
        {parcalar.map((parca, index) => (
          <span key={index} className="flex items-center gap-0.5">
            <ChevronRight className="size-3 text-subtle" aria-hidden />
            <button
              type="button"
              onClick={() => setCwd(`/${parcalar.slice(0, index + 1).join("/")}`)}
              className="rounded px-1 font-mono transition-colors hover:text-brand"
            >
              {parca}
            </button>
          </span>
        ))}
      </nav>

      {error && <p className="mb-2 rounded bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      {notice && <p className="mb-2 rounded bg-ok/10 px-3 py-2 text-sm text-ok">{notice}</p>}

      {yazmaKapali && (
        <p className="mb-2 rounded border border-warn/40 bg-warn/10 px-2.5 py-1.5 text-xs text-warn">
          <Rich
            text={t("docker.files.writeBlocked")}
            values={{
              proc: <code className="font-mono">/proc</code>,
              sys: <code className="font-mono">/sys</code>,
              dev: <code className="font-mono">/dev</code>,
            }}
          />
        </p>
      )}

      {editing ? (
        <div className="rounded-lg border border-line">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
            <code className="font-mono text-xs">{editing.path}</code>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-subtle">{bytes(editing.size)}</span>
              <button
                type="button"
                onClick={() => setEditing(null)}
                title={t("common.actions.close")}
                className="rounded border border-line p-1 text-subtle transition-colors hover:text-ink"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>

          {editing.binary ? (
            <p className="px-3 py-3 text-sm text-subtle">
              <Rich
                text={t("docker.files.binary")}
                values={{ binary: <strong>{t("docker.files.binaryWord")}</strong> }}
              />
            </p>
          ) : (
            <textarea
              value={editing.text}
              onChange={(event) => setEditing({ ...editing, text: event.target.value })}
              disabled={!canAct || busy}
              rows={18}
              spellCheck={false}
              className="w-full resize-y border-0 bg-canvas p-3 font-mono text-[12px] outline-none disabled:opacity-70"
            />
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
            <a
              href={`${base}?mode=download&path=${encodeURIComponent(editing.path)}`}
              className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs transition-colors hover:border-brand"
            >
              <Download className="size-3.5" /> {t("docker.files.download")}
            </a>

            {canAct && !editing.binary && (
              <button
                type="button"
                onClick={() => void kaydet()}
                disabled={busy || editing.text === editing.original}
                className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <Save className="size-3.5" /> {t("common.actions.save")}
              </button>
            )}

            {editing.text !== editing.original && (
              <span className="text-[11px] text-warn">{t("docker.files.unsaved")}</span>
            )}
          </div>
        </div>
      ) : (
        <>
          {entries.length === 0 && !error && (
            <p className="text-sm text-subtle">{t("docker.files.emptyDir")}</p>
          )}

          {entries.length > 0 && (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {entries.map((entry) => (
                <li
                  key={entry.path}
                  className="flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-canvas"
                >
                  <span className="shrink-0 text-subtle">
                    {entry.type === "dizin" ? (
                      <Folder className="size-3.5" />
                    ) : entry.type === "sembolik" ? (
                      <Link2 className="size-3.5" />
                    ) : (
                      <FileIcon className="size-3.5" />
                    )}
                  </span>

                  <button
                    type="button"
                    onClick={() =>
                      entry.type === "dizin" || entry.type === "sembolik"
                        ? setCwd(entry.path)
                        : void ac(entry)
                    }
                    className="min-w-0 flex-1 truncate text-left font-mono transition-colors hover:text-brand"
                    title={entry.linkTarget ? `→ ${entry.linkTarget}` : entry.path}
                  >
                    {entry.name}
                    {entry.linkTarget && (
                      <span className="text-subtle"> → {entry.linkTarget}</span>
                    )}
                  </button>

                  <span className="hidden shrink-0 font-mono text-[10px] text-subtle sm:inline">
                    {entry.permissions}
                  </span>
                  <span className="hidden w-20 shrink-0 text-right text-subtle sm:inline">
                    {entry.type === "dizin" ? "—" : bytes(entry.size)}
                  </span>

                  {entry.type === "dosya" && (
                    <a
                      href={`${base}?mode=download&path=${encodeURIComponent(entry.path)}`}
                      title={t("docker.files.download")}
                      className="shrink-0 rounded border border-line p-1 text-subtle transition-colors hover:text-brand"
                    >
                      <Download className="size-3" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canAct && !yazmaKapali && (
            <label className="mt-2 flex w-fit cursor-pointer items-center gap-1.5 rounded border border-line px-2 py-1 text-xs transition-colors hover:border-brand">
              <Upload className="size-3" />
              {t("docker.files.upload")}
              <input
                type="file"
                className="hidden"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void yukle(file);
                  event.target.value = "";
                }}
              />
            </label>
          )}
        </>
      )}

      <p className="mt-3 text-xs text-subtle">
        <Rich
          text={t("docker.files.layerNote")}
          values={{
            layer: <strong>{t("docker.files.layerWord")}</strong>,
            cmd: <code className="font-mono">compose up</code>,
          }}
        />
        {maxBytes > 0 && (
          <> {t("docker.files.sizeLimit", { limit: Math.round(maxBytes / 1024) })}</>
        )}
      </p>
    </Section>
  );
}
