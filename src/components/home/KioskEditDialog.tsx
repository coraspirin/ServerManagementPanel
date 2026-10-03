"use client";

import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Modal } from "@/components/Modal";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import type { WidgetPlacement } from "@/lib/dashboard/catalog";
import type { KioskTokenView } from "@/lib/home/kiosk";
import { useFormat, useT } from "@/lib/i18n/client";
import { LayoutEditor } from "./LayoutEditor";

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

type LayoutPayload = { layout?: WidgetPlacement[]; custom?: boolean; error?: string };

/**
 * Kiosk bağlantısını düzenler: ad, süre ve o ekranda görünecek widget'lar.
 *
 * Bağlantıya özel düzen yoksa liste sahibin kendi düzeniyle açılıyor ve
 * "sahibinin düzenini izliyor" yazıyor. Kaydetmek bağlantıya özel bir kopya
 * yazar; "Sahibin düzenine dön" o kopyayı siler. Süre alanı boşsa dokunulmaz;
 * 0 süresiz yapar, sayı bugünden itibaren gün sayar (oluşturmadaki kural).
 */
export function KioskEditDialog({
  token,
  onClose,
  onSaved,
}: {
  token: KioskTokenView;
  onClose: () => void;
  onSaved: (tokens: KioskTokenView[]) => void;
}) {
  const t = useT();
  const f = useFormat();
  const [name, setName] = useState(token.name);
  const [days, setDays] = useState("");
  const [layout, setLayout] = useState<WidgetPlacement[] | null>(null);
  const [custom, setCustom] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/kiosk?layout=${token.fingerprint}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const data = (await response.json()) as LayoutPayload;
        if (!response.ok || !data.layout) {
          setError(data.error ?? t("home.kiosk.editLoadFailed"));
          return;
        }
        setLayout(data.layout);
        setCustom(data.custom === true);
      } catch {
        if (!controller.signal.aborted) setError(t("common.errors.network"));
      }
    })();
    return () => controller.abort();
  }, [token.fingerprint, t]);

  async function save(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/kiosk", {
        method: "PATCH",
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: JSON.stringify({ fingerprint: token.fingerprint, ...body }),
      });
      const data = (await response.json()) as LayoutPayload & { tokens?: KioskTokenView[] };
      if (!response.ok) {
        setError(data.error ?? t("home.kiosk.editFailed"));
        return false;
      }
      if (data.tokens) onSaved(data.tokens);
      return true;
    } catch {
      setError(t("common.errors.network"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    const body: Record<string, unknown> = { name };
    if (days.trim() !== "") body.days = Number(days);
    // Düzene dokunulmadıysa gönderilmiyor: sahibini izleyen bir bağlantı
    // yalnızca adı değişti diye sahibinden kopmasın.
    if (dirty && layout) {
      body.layout = layout.map((entry) => ({ key: entry.key, visible: entry.visible, size: entry.size }));
    }
    if (await save(body)) onClose();
  }

  return (
    <Modal open title={t("home.kiosk.editTitle", { name: token.name || token.fingerprint })} onClose={onClose} wide>
      <div className="space-y-4 p-5">
        {error && (
          <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium">{t("users.roles.name")}</span>
            <input
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("home.kiosk.namePlaceholder")}
              className="mt-1 w-full rounded-md border border-line bg-canvas px-3 py-1.5 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium">{t("home.kiosk.editValidity")}</span>
            <input
              value={days}
              inputMode="numeric"
              onChange={(event) => setDays(event.target.value.replace(/[^0-9]/g, ""))}
              placeholder={
                token.expiresAt === null
                  ? t("home.kiosk.noExpiry")
                  : t("home.kiosk.expires", { when: f.dateTime(token.expiresAt * 1000) })
              }
              className="mt-1 w-full rounded-md border border-line bg-canvas px-3 py-1.5 text-sm"
            />
            <span className="mt-1 block text-[11px] text-subtle">{t("home.kiosk.editValidityHelp")}</span>
          </label>
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{t("home.kiosk.editLayout")}</h3>
            <span className="text-xs text-subtle">
              {custom ? t("home.kiosk.editCustom") : t("home.kiosk.editFollowsOwner", { owner: token.createdBy })}
            </span>
            {custom && (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  if (!confirm(t("home.kiosk.editConfirmReset"))) return;
                  if (await save({ resetLayout: true })) onClose();
                }}
                className="ml-auto flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs text-subtle transition-colors hover:text-ink disabled:opacity-50"
              >
                <RotateCcw className="size-3.5" /> {t("home.kiosk.editReset")}
              </button>
            )}
          </div>
          {layout === null ? (
            !error && <p className="py-6 text-center text-sm text-subtle">{t("common.states.loading")}</p>
          ) : (
            <div className="max-h-[50vh] overflow-y-auto">
              <LayoutEditor
                order={layout}
                onChange={(next) => {
                  setLayout(next);
                  setDirty(true);
                }}
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:text-ink"
          >
            {t("common.actions.cancel")}
          </button>
          <button
            type="button"
            disabled={busy || layout === null}
            onClick={() => void submit()}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? t("common.states.saving") : t("common.actions.save")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
