"use client";

import { useState } from "react";
import { Play, RotateCw, Square, Trash2, X } from "lucide-react";
import { readCsrfToken } from "./detail/shared";
import { CSRF_HEADER } from "@/lib/auth/types";
import type { ContainerView, DockerOverview } from "@/lib/docker/types";
import type { ContainerAction } from "@/lib/providers/types";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";

/**
 * Seçili container'lara toplu işlem (M3.30).
 *
 * ## Neden sırayla, `Promise.all` ile değil
 *
 * Yirmi container'ı aynı anda yeniden başlatmak Docker daemon'ını ve sunucuyu
 * gereksiz zorlar: her biri kendi imajını, ağını ve volume'lerini aynı anda
 * bağlamaya çalışır. Tek çekirdekli bir VPS'te bu, panelin kendisinin de
 * yanıt veremediği bir dakika demek.
 *
 * Sıra ayrıca ARIZAYI OKUNUR yapıyor: "üçüncüde patladı, kalan dördü geçti"
 * denebiliyor. Paralel çalıştırmada hangi hatanın hangi container'a ait
 * olduğu ve neyin gerçekten çalıştığı karışır.
 *
 * ## Biri patlarsa diğerleri denenir
 *
 * İlk hatada durmak, kullanıcıyı listeyi elle temizleyip baştan başlamaya
 * zorlardı. Bunun yerine hepsi denenir ve sonunda kimin geçtiği, kimin neden
 * geçmediği tek tek yazılır.
 */

type Sonuc = { name: string; ok: boolean; error?: string };

const CONFIRM_KEY: Record<ContainerAction, MessageKey> = {
  start: "docker.bulk.confirm.start",
  stop: "docker.bulk.confirm.stop",
  restart: "docker.bulk.confirm.restart",
  pause: "docker.bulk.confirm.pause",
  unpause: "docker.bulk.confirm.unpause",
};

export function BulkBar({
  selected,
  onDone,
  onClear,
}: {
  selected: ContainerView[];
  /** Her adımdan sonra gelen güncel tablo — son yanıt ekrana yansıtılır. */
  onDone: (data: DockerOverview) => void;
  onClear: () => void;
}) {
  const t = useT();
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(
    null,
  );
  const [results, setResults] = useState<Sonuc[] | null>(null);

  async function run(action: ContainerAction | "remove") {
    if (selected.length === 0) return;

    const isim = selected.map((entry) => entry.name);
    const onay =
      action === "remove"
        ? // Silme geri alınamıyor; onay metni HANGİ container'ların gideceğini
          // tek tek saymalı. "4 container silinsin mi?" diye sormak, seçimin
          // ne olduğunu hatırlamayı kullanıcıya bırakmak olurdu.
          t("docker.bulk.confirmRemove", { count: isim.length, names: isim.join("\n") })
        : t(CONFIRM_KEY[action], { count: isim.length, names: isim.join("\n") });

    if (!confirm(onay)) return;

    setResults(null);
    const toplanan: Sonuc[] = [];

    for (const [index, container] of selected.entries()) {
      setProgress({ done: index, total: selected.length, current: container.name });

      const url =
        action === "remove"
          ? `/api/docker/${encodeURIComponent(container.id)}/remove`
          : `/api/docker/${encodeURIComponent(container.id)}/action`;

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
          body: action === "remove" ? undefined : JSON.stringify({ action }),
        });
        const payload = (await response.json()) as DockerOverview & { error?: string };

        if (response.ok) {
          toplanan.push({ name: container.name, ok: true });
          // Her adımın yanıtı güncel tabloyu taşıyor; ekranı adım adım
          // tazelemek işlemin ilerlediğini görünür kılıyor.
          onDone(payload);
        } else {
          toplanan.push({ name: container.name, ok: false, error: payload.error ?? t("docker.bulk.failed") });
        }
      } catch {
        toplanan.push({ name: container.name, ok: false, error: t("docker.bulk.network") });
      }
    }

    setProgress(null);
    setResults(toplanan);
    // Seçim TEMİZLENMİYOR: bir kısmı başarısız olduysa kullanıcı aynı seçimle
    // yeniden deneyebilmeli. Silmede zaten kaybolan satırlar listeden düşüyor.
  }

  const hatalar = results?.filter((entry) => !entry.ok) ?? [];
  const calisiyor = progress !== null;

  return (
    <div className="rounded-lg border border-brand/40 bg-brand/5 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{t("docker.bulk.selected", { count: selected.length })}</span>

        <div className="flex flex-wrap items-center gap-1.5">
          <BulkButton
            label={t("docker.bulk.start")}
            icon={<Play className="size-3.5" />}
            disabled={calisiyor}
            onClick={() => void run("start")}
          />
          <BulkButton
            label={t("docker.bulk.restart")}
            icon={<RotateCw className="size-3.5" />}
            disabled={calisiyor}
            onClick={() => void run("restart")}
          />
          <BulkButton
            label={t("docker.bulk.stop")}
            icon={<Square className="size-3.5" />}
            danger
            disabled={calisiyor}
            onClick={() => void run("stop")}
          />
          <BulkButton
            label={t("docker.bulk.remove")}
            icon={<Trash2 className="size-3.5" />}
            danger
            disabled={calisiyor}
            onClick={() => void run("remove")}
          />
        </div>

        <button
          type="button"
          onClick={onClear}
          disabled={calisiyor}
          className="ml-auto inline-flex items-center gap-1 text-xs text-subtle transition-colors hover:text-ink disabled:opacity-40"
        >
          <X className="size-3.5" aria-hidden />
          {t("docker.bulk.clear")}
        </button>
      </div>

      {progress && (
        <p className="mt-2 text-xs text-subtle" aria-live="polite">
          {progress.done + 1} / {progress.total} —{" "}
          {t("docker.bulk.processing", { current: progress.current })}
        </p>
      )}

      {results && (
        <div className="mt-2 text-xs" aria-live="polite">
          <p className={hatalar.length > 0 ? "text-warn" : "text-ok"}>
            {t("docker.bulk.summary", { ok: results.length - hatalar.length, total: results.length })}
            {hatalar.length > 0 && t("docker.bulk.errors", { count: hatalar.length })}
          </p>
          {hatalar.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-subtle">
              {hatalar.map((entry) => (
                <li key={entry.name}>
                  <span className="text-ink">{entry.name}</span>: {entry.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function BulkButton({
  label,
  icon,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-xs transition-colors disabled:opacity-40 ${
        danger ? "hover:border-danger hover:text-danger" : "hover:border-brand hover:text-brand"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
