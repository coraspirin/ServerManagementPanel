"use client";

import { useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import { useT } from "@/lib/i18n/client";
import { withHostQuery } from "@/lib/client/host";

/**
 * Container içi terminal (M1.9).
 *
 * Akış iki parça: çıktı `EventSource` ile, giriş POST ile (sebebi
 * `lib/docker/exec.ts`'te yazılı — Route Handler'lar WebSocket yapamıyor).
 *
 * Tuş vuruşları **biriktirilerek** gönderiliyor: her karakter için ayrı bir
 * istek atmak, yapıştırılan bir metinde yüzlerce istek demekti. 12 ms'lik
 * toplama penceresi insan eliyle fark edilmiyor ama yapıştırmayı tek isteğe
 * indiriyor.
 */
/** Sunucunun kabul ettiği kabuklar; sunucu tarafındaki listeyle aynı. */
/** "auto" dışındakiler dosya yolu; adları çevrilmez, "auto" dil dosyasından. */
const SHELLS = [
  { value: "auto", label: null },
  { value: "/bin/bash", label: "bash" },
  { value: "/bin/sh", label: "sh" },
  { value: "/bin/zsh", label: "zsh" },
  { value: "/bin/ash", label: "ash" },
];

const MIN_FONT = 10;
const MAX_FONT = 20;

export function TerminalPane({
  containerId,
  containerName,
}: {
  containerId: string;
  containerName: string;
}) {
  const t = useT();
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [status, setStatus] = useState<"acilyor" | "acik" | "kapali">("acilyor");
  const [error, setError] = useState<string | null>(null);

  /*
    Kabuk, kullanıcı ve oturum sayacı BİRLİKTE effect'in bağımlılığı.

    Kabuk değiştirmek çalışan oturumu kapatıp yenisini açmak demek — aynı
    exec'e sonradan başka bir kabuk söyletmenin yolu yok. `nonce` ise "aynı
    ayarlarla yeniden bağlan" düğmesini mümkün kılıyor: bağımlılıklar
    değişmediği için effect kendiliğinden yeniden çalışmazdı.
  */
  const [shell, setShell] = useState("auto");
  const [user, setUser] = useState("");
  const [nonce, setNonce] = useState(0);
  const [font, setFont] = useState(13);

  /**
   * Sanal tuş çubuğu bir diziyi kullanıcı yazmış gibi terminale verir;
   * `term.input()` normal `onData` yolundan geçtiği için biriktirme ve
   * gönderme mantığını ikinci kez yazmaya gerek kalmıyor. Ardından odak
   * terminale döndürülüyor — yoksa mobil klavye her dokunuşta kapanırdı.
   */
  function sendKey(sequence: string) {
    termRef.current?.input(sequence);
    termRef.current?.focus();
  }

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const csrf = (() => {
      const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
      return match ? decodeURIComponent(match[1]) : "";
    })();

    const term = new Terminal({
      fontSize: font,
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      cursorBlink: true,
      convertEol: false,
      scrollback: 5000,
      theme: { background: "#00000000" },
      allowTransparency: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    termRef.current = term;

    let sessionId: string | null = null;
    let source: EventSource | null = null;
    let outbox = "";
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const post = (body: unknown) =>
      fetch(`/api/terminal/${sessionId}`, {
        method: "POST",
        headers: { "content-type": "application/json", [CSRF_HEADER]: csrf },
        body: JSON.stringify(body),
      }).catch(() => {
        /* Tek bir tuş kaybı için terminali kapatmaya değmez. */
      });

    const flush = () => {
      flushTimer = null;
      if (!sessionId || outbox === "") return;
      const data = outbox;
      outbox = "";
      void post({ data });
    };

    term.onData((data) => {
      outbox += data;
      if (flushTimer === null) flushTimer = setTimeout(flush, 12);
    });

    const onResize = () => {
      fit.fit();
      if (sessionId) void post({ cols: term.cols, rows: term.rows });
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(host);

    (async () => {
      try {
        const response = await fetch(
          `/api/docker/${encodeURIComponent(containerId)}/terminal`,
          {
            method: "POST",
            headers: { "content-type": "application/json", [CSRF_HEADER]: csrf },
            body: JSON.stringify({ cols: term.cols, rows: term.rows, shell, user }),
          },
        );
        const payload = await response.json();
        if (disposed) return;

        if (!response.ok) {
          setError(payload.error ?? t("docker.terminal.openFailed"));
          setStatus("kapali");
          return;
        }

        sessionId = payload.sessionId as string;
        setStatus("acik");

        source = new EventSource(withHostQuery(`/api/terminal/${sessionId}`));
        source.addEventListener("out", (event) => {
          term.write(JSON.parse((event as MessageEvent).data) as string);
        });
        source.addEventListener("bitti", (event) => {
          const { exitCode } = JSON.parse((event as MessageEvent).data) as {
            exitCode: number | null;
          };
          const kapanis =
            exitCode !== null
              ? t("docker.terminal.sessionClosedCode", { code: exitCode })
              : t("docker.terminal.sessionClosed");
          term.writeln(`\r\n\x1b[90m${kapanis}\x1b[0m`);
          setStatus("kapali");
          source?.close();
        });
        source.addEventListener("hata", (event) => {
          const { message } = JSON.parse((event as MessageEvent).data) as { message: string };
          setError(message);
        });

        term.focus();
      } catch {
        if (!disposed) {
          setError(t("common.errors.network"));
          setStatus("kapali");
        }
      }
    })();

    return () => {
      disposed = true;
      observer.disconnect();
      if (flushTimer) clearTimeout(flushTimer);
      source?.close();
      // Pencere kapanınca container içindeki kabuk da kapanmalı; aksi halde
      // her açılan terminal arkada bir süreç bırakırdı.
      if (sessionId) {
        void fetch(`/api/terminal/${sessionId}`, {
          method: "DELETE",
          headers: { [CSRF_HEADER]: csrf },
          keepalive: true,
        }).catch(() => {});
      }
      term.dispose();
      termRef.current = null;
    };
    // `font` bilerek DIŞARIDA: boyut değiştirmek oturumu kapatmamalı, aşağıdaki
    // ayrı effect çalışan terminale uyguluyor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerId, shell, user, nonce]);

  /*
    Font boyutu ÇALIŞAN terminale uygulanıyor: oturumu kapatıp yeniden açmak,
    o ana kadarki çıktıyı ve çalışan komutu kaybetmek olurdu. Yeniden ölçüm
    şart — xterm satır/sütun sayısını piksel boyutundan hesaplıyor.
  */
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = font;
    window.dispatchEvent(new Event("resize"));
  }, [font]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 text-subtle">
          <span
            className={`size-2 rounded-full ${
              status === "acik" ? "bg-ok" : status === "acilyor" ? "bg-warn" : "bg-line"
            }`}
          />
          {status === "acik"
            ? t("docker.terminal.statusOpen", { name: containerName })
            : status === "acilyor"
              ? t("docker.terminal.statusOpening")
              : t("docker.terminal.statusClosed")}
        </span>
        <span className="text-subtle">{t("docker.terminal.rootWarning")}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1.5">
          <span className="text-subtle">{t("docker.terminal.shell")}</span>
          <select
            value={shell}
            onChange={(e) => setShell(e.target.value)}
            className="rounded-md border border-line bg-surface px-2 py-1 text-xs outline-none focus:border-brand"
          >
            {SHELLS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label ?? t("docker.terminal.shellAuto")}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5">
          <span className="text-subtle">{t("docker.terminal.user")}</span>
          <input
            type="text"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder={t("docker.terminal.userPlaceholder")}
            title={t("docker.terminal.userTitle")}
            className="w-28 rounded-md border border-line bg-surface px-2 py-1 text-xs outline-none focus:border-brand"
          />
        </label>

        <button
          type="button"
          onClick={() => setNonce((v) => v + 1)}
          className="rounded-md border border-line px-2 py-1 text-xs text-subtle transition-colors hover:border-brand hover:text-brand"
        >
          {t("docker.terminal.reconnect")}
        </button>

        <div className="ml-auto flex items-center gap-px">
          <FontButton
            title={t("docker.terminal.fontSmaller")}
            disabled={font <= MIN_FONT}
            onClick={() => setFont((v) => Math.max(MIN_FONT, v - 1))}
          >
            <Minus className="size-3" />
          </FontButton>
          <FontButton
            title={t("docker.terminal.fontLarger")}
            disabled={font >= MAX_FONT}
            onClick={() => setFont((v) => Math.min(MAX_FONT, v + 1))}
          >
            <Plus className="size-3" />
          </FontButton>
        </div>
      </div>

      <p className="text-[11px] text-subtle">
        {t("docker.terminal.sessionNote")}
      </p>

      {error && (
        <p className="rounded border border-danger/40 px-3 py-1.5 text-xs text-danger">{error}</p>
      )}

      <div
        ref={hostRef}
        className="h-[50dvh] overflow-hidden rounded-md border border-line bg-canvas p-2 sm:h-[60vh]"
      />

      {/*
        Dokunmatik klavyede Esc, Tab, Ctrl ve ok tuşları yok — onlarsız bir
        kabuk neredeyse kullanılamaz (tamamlama yok, çalışan komut kesilemez,
        geçmiş gezilemez). Masaüstünde gerçek klavye zaten var, o yüzden
        çubuk yalnızca `sm` altında.
      */}
      <div className="flex flex-wrap gap-1.5 sm:hidden">
        {TOUCH_KEYS.map((key) => (
          <button
            key={key.label}
            type="button"
            onClick={() => sendKey(key.sequence)}
            className="rounded-md border border-line px-2.5 py-1 font-mono text-xs text-subtle transition-colors hover:border-brand hover:text-brand"
          >
            {key.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Sanal tuş çubuğu — etiket ve gönderilecek ham dizi. */
const TOUCH_KEYS: { label: string; sequence: string }[] = [
  { label: "Esc", sequence: "\x1b" },
  { label: "Tab", sequence: "\t" },
  { label: "Ctrl+C", sequence: "\x03" },
  { label: "Ctrl+D", sequence: "\x04" },
  { label: "↑", sequence: "\x1b[A" },
  { label: "↓", sequence: "\x1b[B" },
  { label: "←", sequence: "\x1b[D" },
  { label: "→", sequence: "\x1b[C" },
];

function FontButton({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-line p-1.5 text-subtle transition-colors hover:border-brand hover:text-brand disabled:opacity-40"
    >
      {children}
    </button>
  );
}
