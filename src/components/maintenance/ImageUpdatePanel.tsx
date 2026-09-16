"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import type { ImageUpdate } from "@/lib/updates";
import { useFormat, useT } from "@/lib/i18n/client";
import { Rich } from "@/lib/i18n/rich";
import type { MessageKey } from "@/lib/i18n/translate";

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

/**
 * Tek satırlık güncelleme (M1.11).
 *
 * Sunucu ilerlemeyi SSE olarak akıtıyor ama `EventSource` yalnızca GET
 * yapabildiği için yanıt gövdesi elle okunuyor. Güncelleme dakikalar
 * sürebilir; her adımın ekranda görünmesi "dondu mu?" sorusunu ortadan
 * kaldırıyor.
 */
function UpdateRow({
  entry,
  canAct,
  onDone,
}: {
  entry: ImageUpdate;
  canAct: boolean;
  onDone: () => void;
}) {
  const t = useT();
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (
      !confirm(t("maintenance.images.confirmUpdate", { name: entry.container }))
    ) {
      return;
    }

    setBusy(true);
    setFailed(null);
    setResult(null);
    setProgress(t("maintenance.images.starting"));

    try {
      const response = await fetch(
        `/api/docker/${encodeURIComponent(entry.container)}/update`,
        { method: "POST", headers: { [CSRF_HEADER]: readCsrfToken() } },
      );

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null);
        setFailed(payload?.error ?? t("maintenance.images.startFailed"));
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const eventName = chunk.match(/^event: (.+)$/m)?.[1];
          const dataLine = chunk.match(/^data: (.+)$/m)?.[1];
          if (!eventName || !dataLine) continue;
          const data = JSON.parse(dataLine);

          if (eventName === "adim") {
            setProgress(`${data.step}${data.detail ? `: ${data.detail}` : ""}`);
          } else if (eventName === "bitti") {
            // Engellenen güncelleme bir HATA değil, bir KARAR — ama "zaten
            // güncel" ile karıştırılmamalı: güncelleme var, panel bilerek
            // uygulamadı (M3.28).
            if (data.blockedBy) {
              setFailed(t("maintenance.images.blocked", { reason: data.blockedBy }));
              setProgress(null);
              return;
            }
            setResult(
              data.changed
                ? t("maintenance.images.updated") +
                    (data.scanSummary ? ` — ${data.scanSummary}` : "")
                : t("maintenance.images.upToDate"),
            );
            setProgress(null);
            onDone();
          } else if (eventName === "hata") {
            setFailed(data.message);
            setProgress(null);
          }
        }
      }
    } catch {
      setFailed(t("common.errors.network"));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <li className="rounded border border-line px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{entry.container}</span>
          <span className="font-mono text-[11px] text-subtle">{entry.image}</span>
          <span className="rounded bg-brand/10 px-1.5 text-[10px] font-medium text-brand">
            {t("maintenance.images.newVersion")}
          </span>
        </div>

        {canAct && !result && (
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy}
            className="rounded-md border border-line px-2.5 py-1 text-xs transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
          >
            {busy ? t("maintenance.images.updating") : t("maintenance.images.update")}
          </button>
        )}
      </div>

      {progress && <p className="mt-1 truncate font-mono text-[11px] text-subtle">{progress}</p>}
      {result && <p className="mt-1 text-xs text-ok">{result}</p>}
      {failed && <p className="mt-1 text-xs text-danger">{failed}</p>}
    </li>
  );
}

/** Sıçrama türünün okunur karşılığı. */
const BUMP_LABEL: Record<string, MessageKey> = {
  yama: "maintenance.images.bump.yama",
  minor: "maintenance.images.bump.minor",
  major: "maintenance.images.bump.major",
};

/**
 * Container image güncellemeleri (M1.10).
 *
 * Sonuç önbellekten geliyor; kayıt defterine her sayfa açılışında gitmek
 * saniyeler sürerdi. Kontrolün NE ZAMAN yapıldığı her zaman yazılı — tazeliği
 * gizlenen bir liste, kullanıcıyı "güncelim" sanmaya iter.
 */
export function ImageUpdatePanel({
  initial,
  initialCheckedAt,
  canAct,
}: {
  initial: ImageUpdate[];
  initialCheckedAt: number | null;
  canAct: boolean;
}) {
  const t = useT();
  const f = useFormat();
  const [updates, setUpdates] = useState(initial);
  const [checkedAt, setCheckedAt] = useState(initialCheckedAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/updates/images", {
        method: "POST",
        headers: { [CSRF_HEADER]: readCsrfToken() },
      });
      const payload = await response.json();
      if (!response.ok) setError(payload.error ?? t("maintenance.images.checkFailed"));
      else {
        setUpdates(payload.updates as ImageUpdate[]);
        setCheckedAt(payload.checkedAt as number);
      }
    } catch {
      setError(t("common.errors.network"));
    } finally {
      setBusy(false);
    }
  }

  // Güncellemesi olanlar iki gruba ayrılıyor (M3.27): panelden güncellenebilir
  // olanlar ve muaf tutulanlar. Muafları listeden tamamen çıkarmak "güncelleme
  // yok" izlenimi verirdi — güncelleme VAR, panel dokunmuyor.
  const outdated = updates.filter((entry) => entry.updateAvailable === true && entry.updatable);
  const skipped = updates.filter((entry) => entry.updateAvailable === true && !entry.updatable);
  const unknown = updates.filter((entry) => entry.updateAvailable === null);

  // Sürüm önerisi digest kontrolünden BAĞIMSIZ: etiketin içeriği güncel olsa
  // bile daha yeni bir etiket çıkmış olabilir (M3.29). Ayrı gösteriliyor
  // çünkü ayrı bir karar — biri "yeniden oluştur", diğeri "compose dosyasını
  // düzenle".
  /*
    `flatMap` ile daraltılıyor, `filter` + `!` ile DEĞİL: non-null iddiası
    burada bir kez yalan söyledi ve sayfayı çökertti (eski önbellek satırında
    alan hiç yoktu). Daraltılmış tip, aynı hatayı derleyicinin yakalamasını
    sağlıyor.
  */
  const yeniSurum = updates.flatMap((entry) => {
    const newerTag = entry.newerTag;
    return newerTag ? [{ ...entry, newerTag }] : [];
  });

  return (
    <section className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-5 py-3">
        <div>
          <h2 className="font-semibold">{t("maintenance.images.title")}</h2>
          <p className="mt-0.5 text-xs text-subtle">
            {checkedAt === null
              ? t("maintenance.images.notChecked")
              : t("maintenance.images.lastCheck", { when: f.relative(checkedAt * 1000) })}
          </p>
        </div>

        {canAct && (
          <button
            type="button"
            onClick={() => void check()}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
          >
            <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} />
            {busy ? t("maintenance.images.checking") : t("maintenance.images.checkNow")}
          </button>
        )}
      </div>

      <div className="px-5 py-3 text-sm">
        {error && <p className="mb-2 text-danger">{error}</p>}

        {updates.length === 0 ? (
          <p className="text-subtle">
            {t("maintenance.images.neverRan")}
          </p>
        ) : outdated.length === 0 ? (
          <p className="text-ok">{t("maintenance.images.allCurrent")}</p>
        ) : (
          <ul className="space-y-2">
            {outdated.map((entry) => (
              <UpdateRow
                key={entry.container}
                entry={entry}
                canAct={canAct}
                onDone={() => void check()}
              />
            ))}
          </ul>
        )}

        {yeniSurum.length > 0 && (
          <div className="mt-3 rounded-md border border-brand/40 bg-brand/5 px-3 py-2">
            <p className="text-xs font-medium">
              {t("maintenance.images.newerTags", { count: yeniSurum.length })}
            </p>
            <ul className="mt-1 space-y-0.5 text-[11px]">
              {yeniSurum.map((entry) => (
                <li key={entry.container}>
                  <span className="font-mono">{entry.container}</span>:{" "}
                  <span className="font-mono text-subtle">{entry.image}</span> →{" "}
                  <span className="font-mono text-brand">{entry.newerTag.tag}</span>{" "}
                  <span className="text-subtle">
                    ({BUMP_LABEL[entry.newerTag.bump] ? t(BUMP_LABEL[entry.newerTag.bump]) : entry.newerTag.bump})
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[11px] text-subtle">
              <Rich
                text={t("maintenance.images.newerTagsNote")}
                values={{ tab: <strong>Compose</strong> }}
              />
            </p>
          </div>
        )}

        {skipped.length > 0 && (
          <div className="mt-3 rounded-md border border-line bg-canvas px-3 py-2">
            <p className="text-xs font-medium text-subtle">
              {t("maintenance.images.skipped", { count: skipped.length })}
            </p>
            <ul className="mt-1 space-y-0.5 text-[11px] text-subtle">
              {skipped.map((entry) => (
                <li key={entry.container}>
                  <span className="font-mono">{entry.container}</span>
                  {entry.skipReason ? ` — ${entry.skipReason}` : ""}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[11px] text-subtle">
              <Rich
                text={t("maintenance.images.manual")}
                values={{
                  cmd: <code className="font-mono">docker compose pull && docker compose up -d</code>,
                }}
              />
            </p>
          </div>
        )}

        {unknown.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-subtle">
              {t("maintenance.images.unknown", { count: unknown.length })}
            </summary>
            <ul className="mt-1 space-y-0.5 text-xs text-subtle">
              {unknown.map((entry) => (
                <li key={entry.container}>
                  {entry.container}: {entry.note ?? t("maintenance.images.unknownReason")}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
