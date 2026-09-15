"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import type { ImageUpdate } from "@/lib/updates";

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
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (
      !confirm(
        `"${entry.container}" yeni image ile YENİDEN OLUŞTURULACAK.\n\n` +
          "Servis kısa süre kesintiye uğrar. Yeni sürüm ayağa kalkmazsa panel " +
          "eski container'ı geri getirir.\n\nDevam edilsin mi?",
      )
    ) {
      return;
    }

    setBusy(true);
    setFailed(null);
    setResult(null);
    setProgress("başlıyor…");

    try {
      const response = await fetch(
        `/api/docker/${encodeURIComponent(entry.container)}/update`,
        { method: "POST", headers: { [CSRF_HEADER]: readCsrfToken() } },
      );

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null);
        setFailed(payload?.error ?? "Güncelleme başlatılamadı.");
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
              setFailed(`Güvenlik kapısı engelledi: ${data.blockedBy}`);
              setProgress(null);
              return;
            }
            setResult(
              data.changed
                ? `güncellendi${data.scanSummary ? ` — ${data.scanSummary}` : ""}`
                : "zaten güncel — kayıt defterindeki sürüm zaten kuruluydu",
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
      setFailed("Sunucuya ulaşılamadı.");
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
            yeni sürüm var
          </span>
        </div>

        {canAct && !result && (
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy}
            className="rounded-md border border-line px-2.5 py-1 text-xs transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
          >
            {busy ? "güncelleniyor…" : "Güncelle"}
          </button>
        )}
      </div>

      {progress && <p className="mt-1 truncate font-mono text-[11px] text-subtle">{progress}</p>}
      {result && <p className="mt-1 text-xs text-ok">{result}</p>}
      {failed && <p className="mt-1 text-xs text-danger">{failed}</p>}
    </li>
  );
}

function ago(ts: number): string {
  const minutes = Math.floor((Date.now() / 1000 - ts) / 60);
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} saat önce`;
  return `${Math.floor(hours / 24)} gün önce`;
}

/** Sıçrama türünün okunur karşılığı. */
const BUMP_LABEL: Record<string, string> = {
  yama: "yama sürümü",
  minor: "minör sürüm",
  major: "MAJÖR sürüm — kırıcı değişiklik olabilir",
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
      if (!response.ok) setError(payload.error ?? "Kontrol başarısız.");
      else {
        setUpdates(payload.updates as ImageUpdate[]);
        setCheckedAt(payload.checkedAt as number);
      }
    } catch {
      setError("Sunucuya ulaşılamadı.");
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
          <h2 className="font-semibold">Container image&apos;ları</h2>
          <p className="mt-0.5 text-xs text-subtle">
            {checkedAt === null
              ? "henüz kontrol edilmedi"
              : `son kontrol: ${ago(checkedAt)}`}
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
            {busy ? "kontrol ediliyor…" : "Şimdi kontrol et"}
          </button>
        )}
      </div>

      <div className="px-5 py-3 text-sm">
        {error && <p className="mb-2 text-danger">{error}</p>}

        {updates.length === 0 ? (
          <p className="text-subtle">
            Kontrol henüz çalışmadı. Zamanlanmış iş günde bir kez çalışır; hemen
            görmek için &quot;Şimdi kontrol et&quot;.
          </p>
        ) : outdated.length === 0 ? (
          <p className="text-ok">Tüm image&apos;lar kayıt defterindeki sürümle aynı.</p>
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
              {yeniSurum.length} container için daha yeni bir sürüm etiketi var
            </p>
            <ul className="mt-1 space-y-0.5 text-[11px]">
              {yeniSurum.map((entry) => (
                <li key={entry.container}>
                  <span className="font-mono">{entry.container}</span>:{" "}
                  <span className="font-mono text-subtle">{entry.image}</span> →{" "}
                  <span className="font-mono text-brand">{entry.newerTag.tag}</span>{" "}
                  <span className="text-subtle">
                    ({BUMP_LABEL[entry.newerTag.bump] ?? entry.newerTag.bump})
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[11px] text-subtle">
              Bu tek tıkla uygulanmıyor: etiketi değiştirmek compose dosyasına dokunmak
              demek. Docker ekranında container&apos;a tıklayıp{" "}
              <strong>Compose</strong> sekmesinden imaj etiketini değiştir — panel
              değişikliği önce gösterir, yedek alır ve dosya geçersizse geri alır.
            </p>
          </div>
        )}

        {skipped.length > 0 && (
          <div className="mt-3 rounded-md border border-line bg-canvas px-3 py-2">
            <p className="text-xs font-medium text-subtle">
              {skipped.length} container güncellenebilir ama panel dokunmuyor
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
              Bunları sunucuda elle güncelle:{" "}
              <code className="font-mono">docker compose pull && docker compose up -d</code>
            </p>
          </div>
        )}

        {unknown.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-subtle">
              {unknown.length} image kontrol edilemedi
            </summary>
            <ul className="mt-1 space-y-0.5 text-xs text-subtle">
              {unknown.map((entry) => (
                <li key={entry.container}>
                  {entry.container}: {entry.note ?? "sebep bilinmiyor"}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
