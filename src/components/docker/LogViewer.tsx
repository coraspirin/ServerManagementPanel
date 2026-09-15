"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Minus, Pause, Play, Plus, Search } from "lucide-react";

import { parseAnsi, stripAnsi, type AnsiSpan } from "@/lib/logs/ansi";

/**
 * Canlı container logu (M1.7).
 *
 * `EventSource` kullanılıyor: kopan bağlantıyı tarayıcı kendiliğinden yeniden
 * kuruyor ve normal HTTP olduğu için proxy arkasında ek yapılandırma gerekmiyor.
 *
 * İki küçük ama önemli davranış:
 *   - Otomatik kaydırma YALNIZCA kullanıcı en alttayken yapılır. Yukarı çıkıp
 *     bir hatayı okuyan kişiyi her yeni satırda aşağı fırlatmak sinir bozucudur.
 *   - Bellekte tutulan satır sayısı sınırlı; günlerce açık kalan bir pencere
 *     sekmeyi şişirmemeli.
 */

type Line = { stream: string; ts: string | null; text: string };

const MAX_LINES = 2000;

/** Font boyutu sınırları (px); dışına çıkmak satırları okunmaz yapıyor. */
const MIN_FONT = 9;
const MAX_FONT = 18;

/**
 * ANSI palet adlarının CSS karşılıkları.
 *
 * Ham ANSI renkleri (saf yeşil gibi) koyu zeminde göz yakıyor ve açık temada
 * okunmuyor. Panelin kendi paletini kullanmak logu arayüzün geri kalanıyla
 * aynı görsel dile sokuyor — ve tema değişince renkler de değişiyor.
 */
const ANSI_CSS: Record<string, string> = {
  black: "#3b4048",
  red: "var(--danger)",
  green: "var(--ok)",
  yellow: "var(--warn)",
  blue: "#4c8bf5",
  magenta: "#c678dd",
  cyan: "#56b6c2",
  white: "var(--ink)",
  brightblack: "var(--subtle)",
  brightred: "#ff6b6b",
  brightgreen: "#5dd88a",
  brightyellow: "#f5c451",
  brightblue: "#74a7ff",
  brightmagenta: "#d99ae8",
  brightcyan: "#7cd6e0",
  brightwhite: "var(--ink)",
};

/** Palet adını CSS rengine çevirir; hex değerler olduğu gibi geçiyor. */
function renk(value: string | null): string | undefined {
  if (!value) return undefined;
  return value.startsWith("#") ? value : (ANSI_CSS[value] ?? undefined);
}

/** Tek bir log satırının biçimli parçaları. */
function AnsiLine({ spans }: { spans: AnsiSpan[] }) {
  return (
    <>
      {spans.map((span, index) => {
        // Biçimsiz parçaya `style` vermemek, renksiz logda (çoğu container)
        // DOM'u olduğu gibi bırakıyor.
        const bos =
          !span.fg && !span.bg && !span.bold && !span.italic && !span.underline && !span.dim;

        if (bos) return <span key={index}>{span.text}</span>;

        return (
          <span
            key={index}
            style={{
              color: renk(span.fg),
              backgroundColor: renk(span.bg),
              fontWeight: span.bold ? 600 : undefined,
              fontStyle: span.italic ? "italic" : undefined,
              textDecoration: span.underline ? "underline" : undefined,
              opacity: span.dim ? 0.6 : undefined,
            }}
          >
            {span.text}
          </span>
        );
      })}
    </>
  );
}

export function LogViewer({
  containerId,
  containerName,
  tail,
}: {
  containerId: string;
  containerName: string;
  tail: number;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [paused, setPaused] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [font, setFont] = useState(11);

  const boxRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Duraklatma durumu ref'te tutuluyor: `paused` değişince SSE bağlantısının
  // yeniden kurulması gerekmiyor, yalnızca gelen satırın eklenip eklenmeyeceği
  // değişiyor. Ref'e yazmak render sırasında değil effect'te yapılmalı.
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // Container değişince bileşen parent tarafından `key` ile yeniden kuruluyor,
  // bu yüzden burada durumu elle sıfırlamak gerekmiyor.
  useEffect(() => {
    const source = new EventSource(
      `/api/docker/${encodeURIComponent(containerId)}/logs?tail=${tail}`,
    );

    source.onopen = () => setConnected(true);

    source.addEventListener("log", (event) => {
      if (pausedRef.current) return;
      const line = JSON.parse((event as MessageEvent).data) as Line;
      setLines((previous) => {
        const next = [...previous, line];
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
      });
    });

    source.addEventListener("hata", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { message: string };
      setError(payload.message);
    });

    source.onerror = () => setConnected(false);

    return () => {
      source.close();
      setConnected(false);
    };
  }, [containerId, tail]);

  useEffect(() => {
    if (stickToBottom.current && boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  }, [lines]);

  const filtered = useMemo(
    () =>
      query.trim() === ""
        ? lines
        : /*
            Arama ANSI'DEN ARINDIRILMIŞ metinde yapılıyor: renk kodlarının
            içinde eşleşme bulmak ya da renkli bir kelimenin ortasındaki kaçış
            dizisi yüzünden eşleşmeyi KAÇIRMAK, ikisi de yanlış sonuç verirdi.
          */
          lines.filter((line) =>
            stripAnsi(line.text).toLocaleLowerCase("tr").includes(query.toLocaleLowerCase("tr")),
          ),
    [lines, query],
  );

  /**
   * Görünen satırları düz metin olarak indirir.
   *
   * İndirilen dosyada ANSI dizileri YOK: dosyayı bir metin düzenleyicide ya da
   * bir hata raporunda açan kişi renk kodlarını değil metni görmeli. Arama
   * süzgeci uygulanmış hâli iniyor — kullanıcı ekranda ne görüyorsa o.
   */
  function download() {
    const text = filtered
      .map((line) => {
        const zaman = line.ts ? new Date(line.ts).toISOString() + " " : "";
        const akis = line.stream === "stderr" ? "[stderr] " : "";
        return zaman + akis + stripAnsi(line.text);
      })
      .join("\n");

    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = containerName + "-log.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-subtle">
          <span className={`size-2 rounded-full ${connected ? "bg-ok" : "bg-line"}`} />
          {connected ? "canlı" : "bağlantı yok"} · {lines.length} satır
        </div>

        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="relative min-w-0 flex-1 sm:flex-none">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Logda ara…"
              className="w-full rounded-md border border-line bg-canvas py-1.5 pl-8 pr-2 text-xs outline-none focus:border-brand sm:w-44"
            />
          </div>

          <button
            type="button"
            onClick={() => setPaused((v) => !v)}
            className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs transition-colors hover:border-brand hover:text-brand"
          >
            {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            {paused ? "Devam" : "Duraklat"}
          </button>

          <div className="flex items-center gap-px">
            <IconOnly
              title="Yazıyı küçült"
              disabled={font <= MIN_FONT}
              onClick={() => setFont((v) => Math.max(MIN_FONT, v - 1))}
            >
              <Minus className="size-3" />
            </IconOnly>
            <IconOnly
              title="Yazıyı büyüt"
              disabled={font >= MAX_FONT}
              onClick={() => setFont((v) => Math.min(MAX_FONT, v + 1))}
            >
              <Plus className="size-3" />
            </IconOnly>
          </div>

          <IconOnly title="Görünen satırları .txt olarak indir" onClick={download}>
            <Download className="size-3.5" />
          </IconOnly>
        </div>
      </div>

      {error && (
        <p className="rounded border border-danger/40 px-3 py-1.5 text-xs text-danger">
          {error}
        </p>
      )}

      <div
        ref={boxRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        style={{ fontSize: font + "px" }}
        className="h-[55vh] overflow-auto rounded-md border border-line bg-canvas p-3 font-mono leading-relaxed"
      >
        {filtered.length === 0 ? (
          <p className="text-subtle">
            {lines.length === 0
              ? `${containerName} için henüz log gelmedi.`
              : "Aramayla eşleşen satır yok."}
          </p>
        ) : (
          filtered.map((line, index) => (
            <div
              key={`${index}-${line.ts ?? ""}`}
              className={`whitespace-pre-wrap break-all ${
                line.stream === "stderr" ? "text-danger" : ""
              }`}
            >
              {line.ts && (
                <span className="mr-2 text-subtle">
                  {new Date(line.ts).toLocaleTimeString("tr-TR")}
                </span>
              )}
              <AnsiLine spans={parseAnsi(line.text)} />
            </div>
          ))
        )}
      </div>

      {paused && (
        <p className="text-[11px] text-warn">
          Duraklatıldı — bu sırada gelen satırlar gösterilmiyor (akış açık kalıyor).
        </p>
      )}
    </div>
  );
}

function IconOnly({
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
