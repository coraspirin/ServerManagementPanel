"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, RotateCcw, RotateCw } from "lucide-react";

import { CSRF_HEADER } from "@/lib/auth/types";
import type { Finding } from "@/lib/compose/checks";
import { useT } from "@/lib/i18n/client";

import { diffLines, SEVERITY_CLASS } from "../ComposeSection";
import { readCsrfToken, Section } from "./shared";

/**
 * YAML sekmesi — compose'a ait container'ın compose dosyasını HAM olarak
 * düzenler (dosyanın tamamı, yorumlar ve biçim dahil).
 *
 * Compose sekmesindeki alan alan düzenleyicinin kapsamadığı her şey için:
 * volume, komut, etiket, healthcheck, başka servisler. Akış onunla aynı ve
 * aynı uçtan geçiyor: önce önizleme (satır satır fark + denetim bulguları),
 * onaylanınca yedek alınıp dosya yazılıyor ve `compose up` ile container
 * yeniden oluşturuluyor. `compose up` başarısız olursa yığın durur; aynı
 * ekrandan yedeğe dönülebiliyor.
 */

type Loaded = { text: string; file: string; service: string };
type Preview = { before: string; after: string; findings: Finding[] };

export function YamlTab({ containerId, canAct }: { containerId: string; canAct: boolean }) {
  const t = useT();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stackDown, setStackDown] = useState<{ message: string; backup: string | null } | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/docker/${encodeURIComponent(containerId)}/compose`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) {
          setError(payload.error ?? t("docker.compose.loadFailed"));
          return;
        }
        setLoaded({ text: payload.text, file: payload.location.file, service: payload.location.service });
        setText(payload.text);
        setPreview(null);
      } catch (fetchError) {
        if ((fetchError as Error)?.name !== "AbortError") setError(t("common.errors.network"));
      }
    })();
    return () => controller.abort();
  }, [containerId, t, version]);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/docker/${encodeURIComponent(containerId)}/compose`, {
        method: "POST",
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (payload?.stackDown) {
        setStackDown({ message: payload.message ?? "", backup: payload.backup ?? null });
        return null;
      }
      if (!response.ok) {
        setError(payload.error ?? payload.message ?? t("common.errors.actionFailed"));
        return null;
      }
      return payload;
    } catch {
      setError(t("common.errors.network"));
      return null;
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return error ? (
      <p className="text-sm text-warn">{error}</p>
    ) : (
      <p className="text-sm text-subtle">{t("common.states.loadingInline")}</p>
    );
  }

  const changed = text !== loaded.text;
  const blocked = preview?.findings.some((finding) => finding.severity === "engel") ?? false;

  return (
    <div className="space-y-3">
      <Section
        title={loaded.file}
        action={
          <button
            type="button"
            onClick={() => setVersion((value) => value + 1)}
            disabled={busy}
            title={t("docker.compose.reload")}
            className="rounded border border-line p-1.5 text-subtle transition-colors hover:text-brand disabled:opacity-50"
          >
            <RotateCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} />
          </button>
        }
      >
        <p className="mb-2 text-xs text-subtle">{t("docker.yaml.intro", { service: loaded.service })}</p>

        {stackDown && (
          <div className="mb-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            <p className="font-medium">{t("docker.yaml.stackDown")}</p>
            <p className="mt-1 whitespace-pre-wrap text-xs">{stackDown.message}</p>
            {canAct && stackDown.backup && (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  const result = await send({ action: "restore", backup: stackDown.backup });
                  if (!result) return;
                  setStackDown(null);
                  setNotice(result.message ?? t("docker.compose.restored"));
                  setVersion((value) => value + 1);
                }}
                className="mt-2 flex items-center gap-1.5 rounded-md border border-danger px-2.5 py-1 text-xs font-medium transition-colors hover:bg-danger/10 disabled:opacity-50"
              >
                <RotateCcw className="size-3.5" /> {t("docker.compose.restoreStart")}
              </button>
            )}
          </div>
        )}
        {error && <p className="mb-2 rounded bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        {notice && (
          <p className="mb-2 whitespace-pre-wrap rounded bg-ok/10 px-3 py-2 text-sm text-ok">{notice}</p>
        )}

        <textarea
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setPreview(null);
          }}
          readOnly={!canAct}
          spellCheck={false}
          rows={20}
          aria-label={loaded.file}
          className="block max-h-[60vh] min-h-48 w-full resize-y rounded-md border border-line bg-canvas p-3 font-mono text-[11px] leading-relaxed outline-none focus:border-brand"
        />

        {canAct && changed && !preview && (
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const result = await send({ text, preview: true });
                if (result) setPreview({ before: result.before, after: result.text, findings: result.findings ?? [] });
              }}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {t("docker.compose.review")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setText(loaded.text)}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:text-ink disabled:opacity-50"
            >
              {t("docker.generate.revert")}
            </button>
          </div>
        )}
      </Section>

      {preview && (
        <div className="rounded-lg border border-line">
          {preview.findings.length > 0 && (
            <ul className="space-y-1.5 border-b border-line p-3">
              {preview.findings.map((finding, index) => (
                <li
                  key={`${finding.service}-${finding.title}-${index}`}
                  className={`rounded border px-2.5 py-1.5 text-xs ${SEVERITY_CLASS[finding.severity]}`}
                >
                  <span className="flex flex-wrap items-center gap-1.5">
                    {finding.severity !== "oneri" && <AlertTriangle className="size-3.5 shrink-0" aria-hidden />}
                    <strong>{finding.title}</strong>
                    {finding.line !== undefined && (
                      <span className="opacity-70">· {t("docker.compose.line", { line: finding.line })}</span>
                    )}
                  </span>
                  <span className="mt-0.5 block opacity-90">{finding.detail}</span>
                </li>
              ))}
            </ul>
          )}
          <pre className="max-h-64 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed">
            {diffLines(preview.before, preview.after).map((line, index) => (
              <div
                key={index}
                className={
                  line.sign === "+"
                    ? "text-ok"
                    : line.sign === "-"
                      ? "text-danger line-through opacity-70"
                      : "text-subtle"
                }
              >
                {line.sign} {line.text}
              </div>
            ))}
          </pre>
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="rounded-md border border-line px-3 py-1.5 text-sm"
            >
              {t("common.actions.cancel")}
            </button>
            <button
              type="button"
              disabled={busy || blocked}
              onClick={async () => {
                const result = await send({ text });
                setPreview(null);
                if (!result) return;
                setNotice(
                  [result.message, result.warnings && t("docker.compose.composeWarning", { warnings: result.warnings })]
                    .filter(Boolean)
                    .join("\n\n"),
                );
                setVersion((value) => value + 1);
              }}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {t("docker.compose.saveApply")}
            </button>
            {blocked && <span className="text-xs text-danger">{t("docker.yaml.blocked")}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
