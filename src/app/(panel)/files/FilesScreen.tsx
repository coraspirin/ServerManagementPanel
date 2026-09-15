"use client";

import { useCallback, useState } from "react";
import {
  ChevronRight,
  Download,
  File as FileIcon,
  FilePen,
  Folder,
  FolderPlus,
  HardDrive,
  Link2,
  PieChart,
  RotateCw,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { Modal } from "@/components/Modal";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import type { FileEntry, Listing, UsageEntry } from "@/lib/files/browse";
import type { CleanupItem } from "@/lib/files/cleanup";

/**
 * M3.5 — dosya yöneticisi, disk analizi ve temizlik asistanı.
 *
 * Üç sekme değil tek ekran: aynı klasörde gezinirken "burası neden bu kadar
 * büyük" sorusunu sormak ile dosya silmek aynı işin parçası.
 */

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[index]}`;
}

type Payload = Listing & { roots: string[] };

const RISK_STYLE: Record<CleanupItem["risk"], string> = {
  safe: "bg-ok/10 text-ok",
  caution: "bg-warn/15 text-warn",
  destructive: "bg-danger/15 text-danger",
};

const RISK_LABEL: Record<CleanupItem["risk"], string> = {
  safe: "güvenli",
  caution: "dikkatli ol",
  destructive: "veri kaybı riski",
};

export function FilesScreen({
  initial,
  canWrite,
}: {
  initial: Payload;
  canWrite: boolean;
}) {
  const [listing, setListing] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ entries: UsageEntry[]; totalBytes: number; timedOut: boolean } | null>(null);
  const [editing, setEditing] = useState<{ path: string; content: string; readOnly: boolean } | null>(null);
  const [cleanup, setCleanup] = useState<{ items: CleanupItem[]; totalBytes: number } | null>(null);

  const go = useCallback(async (target: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setUsage(null);
    try {
      const response = await fetch(`/api/files?path=${encodeURIComponent(target)}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as Payload & { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Klasör açılamadı.");
        return;
      }
      setListing(data);
    } catch {
      setError("Sunucuya ulaşılamadı.");
    } finally {
      setBusy(false);
    }
  }, []);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/files", {
        method: "POST",
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as { ok?: boolean; message?: string; error?: string };
      if (!response.ok || data.ok === false) {
        setError(data.error ?? data.message ?? "İşlem başarısız.");
        return false;
      }
      setNotice(data.message ?? "Tamam.");
      await go(listing.path);
      return true;
    } catch {
      setError("Sunucuya ulaşılamadı.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setNotice(`${file.name} yükleniyor…`);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("path", listing.path);

      const response = await fetch("/api/files", {
        method: "POST",
        headers: { [CSRF_HEADER]: readCsrfToken() },
        body: form,
      });
      const data = (await response.json()) as { ok?: boolean; message?: string; error?: string };
      if (!response.ok || data.ok === false) {
        setError(data.error ?? data.message ?? "Yükleme başarısız.");
        return;
      }
      setNotice(`${file.name} yüklendi.`);
      await go(listing.path);
    } catch {
      setError("Sunucuya ulaşılamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function analyze() {
    setBusy(true);
    setError(null);
    setNotice("Klasör boyutları hesaplanıyor…");
    try {
      const response = await fetch(
        `/api/files?mode=usage&path=${encodeURIComponent(listing.path)}`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as {
        entries?: UsageEntry[];
        totalBytes?: number;
        timedOut?: boolean;
        error?: string;
      };
      if (!response.ok) {
        setError(data.error ?? "Analiz başarısız.");
        return;
      }
      setUsage({
        entries: data.entries ?? [],
        totalBytes: data.totalBytes ?? 0,
        timedOut: data.timedOut ?? false,
      });
      setNotice(null);
    } finally {
      setBusy(false);
    }
  }

  async function openFile(entry: FileEntry) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/files?mode=read&path=${encodeURIComponent(entry.path)}`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as {
        content?: string;
        binary?: boolean;
        truncated?: boolean;
        error?: string;
      };
      if (!response.ok) {
        setError(data.error ?? "Dosya okunamadı.");
        return;
      }
      if (data.binary) {
        setError("Bu bir ikili dosya; metin olarak açılamaz. İndirebilirsin.");
        return;
      }
      setEditing({
        path: entry.path,
        content: data.content ?? "",
        // Kesilmiş bir dosyayı kaydetmek gerisini silmek olurdu.
        readOnly: !canWrite || Boolean(data.truncated),
      });
      if (data.truncated) {
        setNotice("Dosya çok büyük — kesilerek gösteriliyor, salt-okunur açıldı.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function loadCleanup() {
    setBusy(true);
    setError(null);
    setNotice("Disk taranıyor…");
    try {
      const response = await fetch("/api/files/cleanup", { cache: "no-store" });
      const data = (await response.json()) as { items?: CleanupItem[]; totalBytes?: number };
      setCleanup({ items: data.items ?? [], totalBytes: data.totalBytes ?? 0 });
      setNotice(null);
    } finally {
      setBusy(false);
    }
  }

  const crumbs = listing.path === "/" ? [] : listing.path.split("/").filter(Boolean);

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-line bg-surface p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-sm">
            <button
              type="button"
              onClick={() => void go("/")}
              className="rounded px-1.5 py-0.5 text-subtle transition-colors hover:text-ink"
            >
              /
            </button>
            {crumbs.map((part, index) => {
              const target = `/${crumbs.slice(0, index + 1).join("/")}`;
              return (
                <span key={target} className="flex items-center">
                  <ChevronRight className="size-3 text-subtle" aria-hidden />
                  <button
                    type="button"
                    onClick={() => void go(target)}
                    className={`rounded px-1 py-0.5 transition-colors hover:text-brand ${
                      index === crumbs.length - 1 ? "font-medium" : "text-subtle"
                    }`}
                  >
                    {part}
                  </button>
                </span>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => void go(listing.path)}
            disabled={busy}
            title="Yenile"
            className="rounded-md border border-line p-1.5 text-subtle transition-colors hover:text-ink disabled:opacity-50"
          >
            <RotateCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => void analyze()}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand disabled:opacity-50"
          >
            <PieChart className="size-4" /> Boyut analizi
          </button>
          <button
            type="button"
            onClick={() => void loadCleanup()}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand disabled:opacity-50"
          >
            <Sparkles className="size-4" /> Temizlik asistanı
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-subtle">
          <span>Kökler:</span>
          {listing.roots.map((root) => (
            <button
              key={root}
              type="button"
              onClick={() => void go(root)}
              className="rounded border border-line px-1.5 py-0.5 font-mono transition-colors hover:border-brand"
            >
              {root}
            </button>
          ))}

          {canWrite && (
            <span className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const name = prompt("Yeni klasör adı:");
                  if (name?.trim()) {
                    void act({ action: "mkdir", path: `${listing.path}/${name.trim()}` });
                  }
                }}
                className="flex items-center gap-1 text-brand hover:underline"
              >
                <FolderPlus className="size-3.5" /> Klasör
              </button>
              <label className="flex cursor-pointer items-center gap-1 text-brand hover:underline">
                <Upload className="size-3.5" /> Yükle
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void upload(file);
                    e.target.value = "";
                  }}
                />
              </label>
            </span>
          )}
        </div>
      </section>

      {error && (
        <p role="alert" className="rounded-lg bg-danger/10 px-4 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}
      {notice && <p className="rounded-lg bg-brand/5 px-4 py-2.5 text-sm text-subtle">{notice}</p>}

      {usage && (
        <section className="rounded-lg border border-line bg-surface p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <HardDrive className="size-4 text-subtle" aria-hidden />
            {listing.path} — {formatBytes(usage.totalBytes)}
            {usage.timedOut && (
              <span className="text-xs font-normal text-warn">
                (süre doldu, sonuç eksik olabilir)
              </span>
            )}
          </h2>
          <ul className="mt-3 space-y-1">
            {usage.entries.slice(0, 20).map((entry) => (
              <li key={entry.path} className="flex items-center gap-3 text-sm">
                <button
                  type="button"
                  onClick={() => entry.isDir && void go(entry.path)}
                  className={`min-w-0 flex-1 truncate text-left sm:w-56 sm:flex-none sm:shrink-0 ${
                    entry.isDir ? "text-brand hover:underline" : ""
                  }`}
                >
                  {entry.name}
                </button>
                <span className="hidden h-2 flex-1 overflow-hidden rounded bg-canvas sm:block">
                  <span
                    className="block h-full bg-brand"
                    style={{
                      width: `${
                        usage.totalBytes > 0
                          ? Math.max(1, (entry.bytes / usage.totalBytes) * 100)
                          : 0
                      }%`,
                    }}
                  />
                </span>
                <span className="w-20 shrink-0 text-right tabular-nums text-subtle">
                  {formatBytes(entry.bytes)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="rtable w-full min-w-[46rem] text-sm">
          <thead className="border-b border-line text-left text-xs text-subtle">
            <tr>
              <th className="px-4 py-2.5 font-medium">Ad</th>
              <th className="px-4 py-2.5 font-medium">Boyut</th>
              <th className="px-4 py-2.5 font-medium">Değişim</th>
              <th className="px-4 py-2.5 font-medium">İzin</th>
              <th className="px-4 py-2.5 font-medium">Sahip</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {listing.parent !== null && (
              <tr className="hover:bg-line/30">
                <td colSpan={6} className="px-4 py-2">
                  <button
                    type="button"
                    onClick={() => void go(listing.parent as string)}
                    className="flex items-center gap-2 text-subtle transition-colors hover:text-ink"
                  >
                    <Folder className="size-4" aria-hidden /> ..
                  </button>
                </td>
              </tr>
            )}

            {listing.entries.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-subtle">
                  Bu klasör boş.
                </td>
              </tr>
            )}

            {listing.entries.map((entry) => (
              <tr key={entry.path} className="hover:bg-line/30">
                <td data-label="" className="px-4 py-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      entry.kind === "dir" ? void go(entry.path) : void openFile(entry)
                    }
                    className="flex items-center gap-2 text-left"
                  >
                    {entry.kind === "dir" ? (
                      <Folder className="size-4 shrink-0 text-brand" aria-hidden />
                    ) : entry.kind === "symlink" ? (
                      <Link2 className="size-4 shrink-0 text-subtle" aria-hidden />
                    ) : (
                      <FileIcon className="size-4 shrink-0 text-subtle" aria-hidden />
                    )}
                    <span className="truncate">{entry.name}</span>
                    {entry.linkTarget && (
                      <span className="truncate text-xs text-subtle">→ {entry.linkTarget}</span>
                    )}
                  </button>
                </td>
                <td data-label="Boyut" className="px-4 py-1.5 tabular-nums text-subtle">
                  {entry.kind === "dir" ? "—" : formatBytes(entry.sizeBytes)}
                </td>
                <td data-label="Değişim" className="whitespace-nowrap px-4 py-1.5 text-xs text-subtle">
                  {new Date(entry.modifiedAt * 1000).toLocaleString("tr-TR")}
                </td>
                <td data-label="İzin" className="px-4 py-1.5 font-mono text-xs text-subtle">
                  {entry.modeText}
                </td>
                <td data-label="Sahip" className="px-4 py-1.5 text-xs text-subtle">
                  {entry.uid}:{entry.gid}
                </td>
                <td data-label="" className="px-4 py-1.5">
                  <div className="flex flex-wrap justify-end gap-1 max-md:justify-start">
                    {entry.kind === "file" && (
                      <a
                        href={`/api/files?mode=download&path=${encodeURIComponent(entry.path)}`}
                        title="İndir"
                        className="rounded border border-line p-1.5 text-subtle transition-colors hover:text-brand"
                      >
                        <Download className="size-3.5" />
                      </a>
                    )}
                    {canWrite && (
                      <>
                        <button
                          type="button"
                          title="Yeniden adlandır"
                          onClick={() => {
                            const name = prompt("Yeni ad:", entry.name);
                            if (name?.trim() && name !== entry.name) {
                              void act({ action: "rename", path: entry.path, newName: name.trim() });
                            }
                          }}
                          className="rounded border border-line p-1.5 text-subtle transition-colors hover:text-ink"
                        >
                          <FilePen className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          title="İzin değiştir"
                          onClick={() => {
                            const mode = prompt("Yeni izin (sekizlik):", entry.modeOctal.slice(-3));
                            if (mode?.trim()) {
                              void act({ action: "chmod", path: entry.path, mode: mode.trim() });
                            }
                          }}
                          className="rounded border border-line px-1.5 py-1.5 font-mono text-[10px] text-subtle transition-colors hover:text-ink"
                        >
                          chmod
                        </button>
                        <button
                          type="button"
                          title="Sil"
                          onClick={() => {
                            const question =
                              entry.kind === "dir"
                                ? `"${entry.name}" klasörü ve İÇİNDEKİ HER ŞEY silinsin mi? Bu geri alınamaz.`
                                : `"${entry.name}" silinsin mi?`;
                            if (confirm(question)) {
                              void act({
                                action: "delete",
                                path: entry.path,
                                recursive: entry.kind === "dir",
                              });
                            }
                          }}
                          className="rounded border border-line p-1.5 text-subtle transition-colors hover:text-danger"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {listing.truncated && (
        <p className="text-center text-xs text-subtle">
          Klasörde {listing.totalEntries.toLocaleString("tr-TR")} girdi var; ilk 2000 tanesi
          gösteriliyor.
        </p>
      )}

      <EditorModal
        key={editing?.path ?? "yok"}
        target={editing}
        busy={busy}
        onClose={() => setEditing(null)}
        onSave={async (content) => {
          if (editing && (await act({ action: "write", path: editing.path, content }))) {
            setEditing(null);
          }
        }}
      />

      <CleanupModal
        open={cleanup !== null}
        data={cleanup}
        canWrite={canWrite}
        onClose={() => setCleanup(null)}
        onChanged={(next) => setCleanup(next)}
      />
    </div>
  );
}

function EditorModal({
  target,
  busy,
  onClose,
  onSave,
}: {
  target: { path: string; content: string; readOnly: boolean } | null;
  busy: boolean;
  onClose: () => void;
  onSave: (content: string) => void;
}) {
  const [content, setContent] = useState(target?.content ?? "");

  return (
    <Modal open={target !== null} title={target?.path ?? ""} onClose={onClose} wide>
      {target && (
        <div className="space-y-3">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            readOnly={target.readOnly}
            spellCheck={false}
            rows={22}
            className="w-full rounded-md border border-line bg-canvas p-3 font-mono text-xs outline-none focus:border-brand"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-subtle">
              {target.readOnly ? "Salt-okunur" : `${content.length} karakter`}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:text-ink"
              >
                Kapat
              </button>
              {!target.readOnly && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onSave(content)}
                  className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  Kaydet
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function CleanupModal({
  open,
  data,
  canWrite,
  onClose,
  onChanged,
}: {
  open: boolean;
  data: { items: CleanupItem[]; totalBytes: number } | null;
  canWrite: boolean;
  onClose: () => void;
  onChanged: (next: { items: CleanupItem[]; totalBytes: number }) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function clean(item: CleanupItem) {
    setBusy(item.id);
    setMessage(null);
    try {
      const response = await fetch("/api/files/cleanup", {
        method: "POST",
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: JSON.stringify({ id: item.id }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        message?: string;
        reclaimedBytes?: number;
        items?: CleanupItem[];
        totalBytes?: number;
      };
      setMessage(
        `${result.message ?? ""}${
          result.reclaimedBytes ? ` — ${formatBytes(result.reclaimedBytes)} kazanıldı.` : ""
        }`,
      );
      if (result.items) {
        onChanged({ items: result.items, totalBytes: result.totalBytes ?? 0 });
      }
    } catch {
      setMessage("Sunucuya ulaşılamadı.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal open={open} title="Disk temizlik asistanı" onClose={onClose} wide>
      <p className="text-xs leading-snug text-subtle">
        Her kalem ayrı ayrı temizlenir. Toplu bir &quot;hepsini sil&quot; düğmesi bilerek yok:
        sarkan image&apos;ları silmek zararsız, kullanılmayan volume&apos;leri silmek veri kaybıdır.
      </p>

      {data && (
        <p className="mt-2 text-sm">
          Toplam geri kazanılabilir: <strong>{formatBytes(data.totalBytes)}</strong>
        </p>
      )}

      {message && <p className="mt-2 rounded-md bg-brand/5 px-3 py-2 text-sm">{message}</p>}

      <ul className="mt-4 divide-y divide-line rounded-md border border-line">
        {(data?.items ?? []).map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {item.label}
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${RISK_STYLE[item.risk]}`}
                >
                  {RISK_LABEL[item.risk]}
                </span>
              </div>
              <p className="text-xs text-subtle">{item.description}</p>
            </div>
            <span className="shrink-0 text-right tabular-nums text-sm">
              {item.bytes > 0 ? formatBytes(item.bytes) : `${item.count} öğe`}
            </span>
            {canWrite && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  const question =
                    item.risk === "destructive"
                      ? `${item.label}: bu işlem VERİ KAYBINA yol açabilir. Devam edilsin mi?`
                      : `${item.label} temizlensin mi?`;
                  if (confirm(question)) void clean(item);
                }}
                className={`shrink-0 rounded-md border px-3 py-1.5 text-sm transition-colors disabled:opacity-50 ${
                  item.risk === "destructive"
                    ? "border-danger/50 text-danger hover:border-danger"
                    : "border-line hover:border-brand"
                }`}
              >
                {busy === item.id ? "Temizleniyor…" : "Temizle"}
              </button>
            )}
          </li>
        ))}
        {data?.items.length === 0 && (
          <li className="px-3 py-8 text-center text-sm text-subtle">
            Temizlenecek bir şey bulunamadı.
          </li>
        )}
      </ul>
    </Modal>
  );
}
