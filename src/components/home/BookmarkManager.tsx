"use client";

import { useState } from "react";
import { Bookmark as BookmarkIcon, Pencil, Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import type { Bookmark, BookmarkGroup } from "@/lib/home/bookmarks";
import { useT } from "@/lib/i18n/client";

/**
 * M2.7 — bookmark yönetimi.
 *
 * Uygulamalar ekranının altında duruyor: ikisi de "ana sayfada ne görünecek"
 * sorusunun cevabı ve ayrı bir menü maddesi açmak, iki tıklama uzağa taşımak
 * dışında bir şey kazandırmazdı.
 */

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

type Form = { id: number | null; group: string; title: string; url: string };

const EMPTY: Form = { id: null, group: "", title: "", url: "" };

const inputClass =
  "w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand";

export function BookmarkManager({ initialGroups }: { initialGroups: BookmarkGroup[] }) {
  const t = useT();
  const [groups, setGroups] = useState(initialGroups);
  const [modal, setModal] = useState<{ open: boolean; form: Form }>({ open: false, form: EMPTY });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(url: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = (await response.json()) as { error?: string; groups?: BookmarkGroup[] };
      if (!response.ok) {
        setError(data.error ?? t("common.errors.actionFailed"));
        return false;
      }
      if (data.groups) setGroups(data.groups);
      return true;
    } catch {
      setError(t("common.errors.network"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const { id, ...payload } = modal.form;
    const ok =
      id === null
        ? await send("/api/bookmarks", "POST", payload)
        : await send(`/api/bookmarks/${id}`, "PATCH", payload);
    if (ok) setModal({ open: false, form: EMPTY });
  }

  async function remove(bookmark: Bookmark) {
    if (!confirm(t("home.bookmarks.confirmDelete", { name: bookmark.title }))) return;
    await send(`/api/bookmarks/${bookmark.id}`, "DELETE");
  }

  const total = groups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <BookmarkIcon className="size-4 text-subtle" aria-hidden />
          {t("home.bookmarks.title")}
          <span className="font-normal text-subtle">{total}</span>
        </h2>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setModal({ open: true, form: EMPTY });
          }}
          className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand"
        >
          <Plus className="size-4" /> {t("home.bookmarks.add")}
        </button>
      </div>

      <p className="mt-1 text-xs text-subtle">
        {t("home.bookmarks.intro")}
      </p>

      {total === 0 ? (
        <p className="mt-4 text-sm text-subtle">{t("home.bookmarks.empty")}</p>
      ) : (
        <div className="mt-4 space-y-4">
          {groups.map((group) => (
            <div key={group.name || "diger"}>
              <h3 className="mb-1.5 text-xs font-semibold text-subtle">
                {group.name || t("home.bookmarks.ungrouped")}
              </h3>
              <ul className="divide-y divide-line rounded-md border border-line">
                {group.items.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{item.title}</span>
                      <span className="block truncate font-mono text-[11px] text-subtle">
                        {item.url}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setModal({
                          open: true,
                          form: {
                            id: item.id,
                            group: item.group,
                            title: item.title,
                            url: item.url,
                          },
                        });
                      }}
                      aria-label={t("home.bookmarks.editAria", { name: item.title })}
                      className="rounded p-1 text-subtle transition-colors hover:text-ink"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(item)}
                      aria-label={t("home.bookmarks.deleteAria", { name: item.title })}
                      className="rounded p-1 text-subtle transition-colors hover:text-danger"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={modal.open}
        title={modal.form.id === null ? t("home.bookmarks.add") : t("home.bookmarks.edit")}
        onClose={() => setModal((m) => ({ ...m, open: false }))}
      >
        <form
          className="space-y-3 px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="block">
            <span className="text-xs font-medium">{t("home.bookmarks.titleField")}</span>
            <input
              type="text"
              value={modal.form.title}
              onChange={(e) =>
                setModal((m) => ({ ...m, form: { ...m.form, title: e.target.value } }))
              }
              autoFocus
              className={`mt-1 ${inputClass}`}
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium">{t("appForm.address")}</span>
            <input
              type="text"
              value={modal.form.url}
              onChange={(e) =>
                setModal((m) => ({ ...m, form: { ...m.form, url: e.target.value } }))
              }
              placeholder="https://..."
              className={`mt-1 font-mono ${inputClass}`}
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium">{t("home.bookmarks.group")}</span>
            <input
              type="text"
              value={modal.form.group}
              onChange={(e) =>
                setModal((m) => ({ ...m, form: { ...m.form, group: e.target.value } }))
              }
              placeholder={t("home.bookmarks.groupPlaceholder")}
              className={`mt-1 ${inputClass}`}
            />
          </label>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setModal((m) => ({ ...m, open: false }))}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:text-ink"
            >
              {t("common.actions.cancel")}
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? t("common.states.saving") : t("common.actions.save")}
            </button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
