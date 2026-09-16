"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight, ChevronUp, Eraser, RefreshCw, TerminalSquare } from "lucide-react";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import { CONSOLE_PRESETS, UPDATE_SEQUENCE, findPreset } from "@/lib/host/presets";
import { useDynamicT, useFormat, useT } from "@/lib/i18n/client";
import { Rich } from "@/lib/i18n/rich";

/**
 * Sunucu konsolu (hazır kalıplar + serbest komut).
 *
 * Üç giriş var ama tek bir çıktı penceresi: hangi yoldan çalıştırılırsa
 * çalıştırılsın komut ve sonucu aynı akışa düşer. Ayrı kutulara bölmek,
 * "az önce ne çalıştırdım" sorusunu cevapsız bırakırdı.
 *
 * Bu bir terminal DEĞİL: her komut ayrı çalışır, ortak bir kabuk oturumu
 * yoktur. `cd /tmp` sonraki komutu etkilemez ve `top` gibi etkileşimli
 * komutlar zaman aşımına kadar bekler. Gerçek terminal Docker container'ları
 * için var (ContainerDrawer → Terminal); host'ta karşılığı yok çünkü
 * host-helper protokolü tek istek/tek yanıt.
 */

type Entry = {
  id: number;
  command: string;
  running: boolean;
  /** İstek hiç host'a ulaşamadı ya da reddedildi. */
  failure?: string;
  exitCode?: number;
  output?: string;
  durationMs?: number;
};

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

type RunResult = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

async function runOnHost(body: unknown): Promise<RunResult> {
  const response = await fetch("/api/host/console", {
    method: "POST",
    headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "");
  return data as RunResult;
}

/** stdout + stderr, ikisi de doluysa ayrılarak. */
function mergeOutput(result: RunResult): string {
  const parts: string[] = [];
  if (result.stdout.trim() !== "") parts.push(result.stdout.replace(/\n+$/, ""));
  if (result.stderr.trim() !== "") parts.push(`[stderr]\n${result.stderr.replace(/\n+$/, "")}`);
  return parts.join("\n\n");
}

function countLines(entry: Entry): number {
  return 1 + (entry.output ? entry.output.split("\n").length : 0);
}

export function ConsolePanel({ maxLines }: { maxLines: number }) {
  const t = useT();
  const dt = useDynamicT();
  const f = useFormat();
  const presetLabel = (key: string) => dt(`console.preset.${key}.label`);
  const presetHint = (preset: { key: string; hint?: boolean }) =>
    preset.hint ? dt(`console.preset.${preset.key}.hint`) : undefined;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [preset, setPreset] = useState(CONSOLE_PRESETS[0].key);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Yukarı/aşağı ok ile geçmiş. -1 = "şu an yazdığım satır".
  const history = useRef<string[]>([]);
  const historyIndex = useRef(-1);
  const nextId = useRef(1);
  const outputRef = useRef<HTMLDivElement>(null);
  // Çalışan ADIMIN başlangıcı — "Güncelle" iki komut çalıştırdığı için
  // sayacın `busy`'ye değil her adıma bağlı olması gerekiyor.
  const stepStartedAt = useRef(0);

  // Yeni satır geldiğinde aşağı kaydır. Kullanıcı yukarı kaydırdıysa
  // rahatsız etmemek için yalnızca dibe yakınsa.
  useEffect(() => {
    const node = outputRef.current;
    if (!node) return;
    if (node.scrollHeight - node.scrollTop - node.clientHeight < 120) {
      node.scrollTop = node.scrollHeight;
    }
  }, [entries]);

  // Uzun komutlarda "takıldı mı" sorusunu geçen süreyle cevaplıyoruz:
  // `apt-get upgrade` dakikalarca sessiz kalabilir.
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(
      () => setElapsed(Math.round((Date.now() - stepStartedAt.current) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [busy]);

  function append(entry: Entry) {
    setEntries((current) => {
      const next = [...current, entry];
      let lines = next.reduce((total, item) => total + countLines(item), 0);
      while (next.length > 1 && lines > maxLines) {
        lines -= countLines(next[0]);
        next.shift();
      }
      return next;
    });
  }

  function update(id: number, patch: Partial<Entry>) {
    setEntries((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    );
  }

  /** Tek bir komut çalıştırır; başarısızsa false döner (dizinin durması için). */
  async function execute(label: string, body: unknown): Promise<boolean> {
    const id = nextId.current++;
    stepStartedAt.current = Date.now();
    setElapsed(0);
    append({ id, command: label, running: true });
    try {
      const result = await runOnHost(body);
      update(id, {
        running: false,
        exitCode: result.exitCode,
        output: mergeOutput(result),
        durationMs: result.durationMs,
      });
      return result.exitCode === 0;
    } catch (error) {
      update(id, {
        running: false,
        failure: (error instanceof Error && error.message) || t("console.unknownError"),
      });
      return false;
    }
  }

  async function runSequence(steps: readonly string[]) {
    setBusy(true);
    try {
      for (const key of steps) {
        const definition = findPreset(key);
        if (!definition) continue;
        // Bir adım başarısızsa devam etmiyoruz: `apt-get update` çökmüşken
        // yükseltmeye geçmek eski paket listesiyle çalışmak demek.
        if (!(await execute(definition.command, { mode: "preset", preset: key }))) break;
      }
    } finally {
      setBusy(false);
    }
  }

  async function runPreset(key: string) {
    const definition = findPreset(key);
    if (!definition) return;
    if (definition.mutates) {
      const hint = presetHint(definition);
      const note = hint ? `\n\n${hint}` : "";
      if (!confirm(t("console.confirmRun", { command: definition.command }) + note)) return;
    }
    setBusy(true);
    try {
      await execute(definition.command, { mode: "preset", preset: key });
    } finally {
      setBusy(false);
    }
  }

  async function runCommand() {
    const command = input.trim();
    if (command === "" || busy) return;

    history.current = [command, ...history.current.filter((item) => item !== command)].slice(0, 100);
    historyIndex.current = -1;
    setInput("");

    setBusy(true);
    try {
      await execute(command, { mode: "exec", command });
    } finally {
      setBusy(false);
    }
  }

  /**
   * Geçmişte bir adım geriye. Klavyedeki ↑ ile dokunmatikteki geçmiş düğmesi
   * aynı işi yapsın diye ayrı bir işlev: telefonda ok tuşu yok ve komutu
   * yeniden yazdırmak, konsolun asıl faydasını (bir daha çalıştır) götürüyor.
   */
  function recallPrevious() {
    if (history.current.length === 0) return;
    historyIndex.current = Math.min(historyIndex.current + 1, history.current.length - 1);
    setInput(history.current[historyIndex.current]);
  }

  function recallNext() {
    if (historyIndex.current < 0) return;
    historyIndex.current -= 1;
    setInput(historyIndex.current < 0 ? "" : history.current[historyIndex.current]);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void runCommand();
      return;
    }
    if (event.key === "ArrowUp") {
      if (history.current.length === 0) return;
      event.preventDefault();
      recallPrevious();
      return;
    }
    if (event.key === "ArrowDown") {
      if (historyIndex.current < 0) return;
      event.preventDefault();
      recallNext();
    }
  }

  const selected = findPreset(preset);

  return (
    <section className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 font-semibold">
            <TerminalSquare className="size-4" /> {t("console.title")}
          </h2>
          <p className="mt-0.5 text-xs text-subtle">
            <Rich
              text={t("console.intro")}
              values={{
                cd: <code className="font-mono">cd</code>,
                top: <code className="font-mono">top</code>,
                nano: <code className="font-mono">nano</code>,
              }}
            />
          </p>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (
              !confirm(t("console.confirmUpdate"))
            ) {
              return;
            }
            void runSequence(UPDATE_SEQUENCE);
          }}
          className="flex items-center gap-1.5 rounded-md border border-brand/40 px-3 py-1.5 text-sm text-brand transition-colors hover:bg-brand/10 disabled:opacity-50"
        >
          <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} />
          {t("console.updateServer")}
        </button>
      </div>

      {/* Hazır kalıplar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
        <select
          value={preset}
          onChange={(event) => setPreset(event.target.value)}
          disabled={busy}
          className="w-full min-w-0 rounded-md border border-line bg-canvas px-2 py-1.5 text-sm outline-none focus:border-brand disabled:opacity-50 sm:w-auto sm:min-w-56"
        >
          {CONSOLE_PRESETS.map((item) => (
            <option key={item.key} value={item.key}>
              {item.mutates ? `⚠ ${presetLabel(item.key)}` : presetLabel(item.key)}
            </option>
          ))}
        </select>

        <button
          type="button"
          disabled={busy}
          onClick={() => void runPreset(preset)}
          className="rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
        >
          {t("console.run")}
        </button>

        {selected && (
          <code
            className="w-full min-w-0 truncate font-mono text-[11px] text-subtle sm:w-auto sm:flex-1"
            title={presetHint(selected)}
          >
            {selected.command}
          </code>
        )}
      </div>

      {/*
        Çıktı. Telefonda 11px mono okunmuyor, o yüzden dar ekranda 12px'e
        çıkıyor; yükseklik de sabit 384px yerine ekranın payına göre veriliyor.
      */}
      <div
        ref={outputRef}
        className="max-h-[60dvh] overflow-auto overscroll-contain bg-canvas px-4 py-3 font-mono text-xs leading-relaxed sm:max-h-96 sm:text-[11px]"
      >
        {entries.length === 0 ? (
          <p className="text-subtle">
            {t("console.emptyOutput")}
          </p>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="mb-3 last:mb-0">
              <div className="flex items-baseline gap-1.5">
                <ChevronRight className="size-3 shrink-0 translate-y-0.5 text-brand" />
                <span className="break-all text-ink">{entry.command}</span>
              </div>

              {entry.running && <div className="pl-4 text-subtle">{t("console.running", { seconds: elapsed })}</div>}

              {entry.failure && (
                <div className="whitespace-pre-wrap break-all pl-4 text-danger">
                  {entry.failure}
                </div>
              )}

              {entry.output !== undefined && entry.output !== "" && (
                <pre className="whitespace-pre-wrap break-all pl-4 text-subtle">{entry.output}</pre>
              )}

              {!entry.running && entry.exitCode !== undefined && (
                <div
                  className={`pl-4 ${entry.exitCode === 0 ? "text-subtle" : "text-warn"}`}
                >
                  {t("console.exitCode", { code: entry.exitCode })}
                  {entry.output === "" && entry.exitCode === 0 ? t("console.noOutput") : ""}
                  {entry.durationMs !== undefined
                    ? t("console.duration", {
                        seconds: f.number(entry.durationMs / 1000, {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 1,
                        }),
                      })
                    : ""}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Serbest komut */}
      <div className="flex items-center gap-2 border-t border-line px-4 py-2.5">
        <ChevronRight className="size-4 shrink-0 text-brand" />
        {/*
          Mobil klavyeler ilk harfi büyütür ve düzeltmeye çalışır: `ls` yerine
          `Ls`, `apt-get` yerine `apt get` yazılır. Kabuk komutunda ikisi de
          komutu sessizce bozar, o yüzden ikisi de kapalı.
        */}
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          enterKeyHint="send"
          placeholder={busy ? t("console.placeholderBusy") : t("console.placeholder")}
          className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none placeholder:text-subtle disabled:opacity-50"
        />
        {/* Ok tuşu olmayan klavyeler için geçmiş — masaüstünde ↑ zaten var. */}
        <button
          type="button"
          disabled={busy}
          onClick={recallPrevious}
          title={t("console.previous")}
          aria-label={t("console.previous")}
          className="flex items-center justify-center rounded-md border border-line p-1.5 text-subtle transition-colors hover:border-brand hover:text-brand disabled:opacity-40 sm:hidden"
        >
          <ChevronUp className="size-3.5" />
        </button>
        <button
          type="button"
          disabled={busy || input.trim() === ""}
          onClick={() => void runCommand()}
          className="rounded-md border border-line px-3 py-1 text-xs transition-colors hover:border-brand hover:text-brand disabled:opacity-40"
        >
          {t("console.send")}
        </button>
        <button
          type="button"
          disabled={entries.length === 0}
          onClick={() => setEntries([])}
          title={t("console.clear")}
          className="rounded-md border border-line p-1.5 text-subtle transition-colors hover:border-brand hover:text-brand disabled:opacity-40"
        >
          <Eraser className="size-3.5" />
        </button>
      </div>
    </section>
  );
}
