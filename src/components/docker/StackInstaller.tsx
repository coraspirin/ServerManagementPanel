"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Finding } from "@/lib/compose/checks";
import { FileCode, HelpCircle, Upload, XCircle } from "lucide-react";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import type { InstalledStack } from "@/lib/appstore/install";
import type { PreflightResult } from "@/lib/appstore/preflight";
import { useT } from "@/lib/i18n/client";
import { Rich } from "@/lib/i18n/rich";

/**
 * Compose yığınları.
 *
 * Burada bir uygulama katalogu vardı (dahili şablonlar + uzak Portainer
 * kaynakları, 475 uygulamaya kadar çıktı) ve kaldırıldı: kullanıcının gerçekten
 * yaptığı şey kendi compose dosyasını getirmekti. Yerine dosya yükleme geldi.
 *
 * Yükleme bölümü BİLEREK modalde değil, sayfanın kendisinde: ekranın tek işi
 * bu, onu bir düğmenin arkasına saklamak yanlış olurdu.
 *
 * Dosya tarayıcıda okunup metin olarak gönderiliyor — multipart yok. Sunucu
 * tarafındaki yazma yolu (geçici root container + `wx`) hiç değişmiyor ve
 * içerik zaten düz metin.
 *
 * Ekranın tepesinde ÖN KONTROL var: host compose çalıştırmaya izin vermiyorsa
 * bu, kullanıcı dosyayı seçip Kur'a bastıktan sonra değil, sayfayı açar açmaz
 * söyleniyor. Yaşanmış olay — dosya yazıldı ama host `compose up`'ı reddetti ve
 * kullanıcı uygulamayı elle kurmak zorunda kaldı.
 */

type Payload = {
  stacks: InstalledStack[];
  stacksRoot: string;
  preflight: PreflightResult;
};

/** `install.ts`'teki `MAX_COMPOSE_BYTES` ile aynı sayı; o modül `server-only`. */
const MAX_COMPOSE_BYTES = 256 * 1024;

/** Yığın adı deseni — sunucudaki `NAME_RE` ile aynı. */
const NAME_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;

/**
 * Bir yığın adı olarak hiçbir şey anlatmayan dosya adları.
 *
 * `docker-compose.yml` neredeyse her dizinde bu adı taşıyor; ondan türetilen
 * "docker-compose" yığın adı kullanıcıya yardım etmez, yanıltır.
 */
const GENERIC_NAMES = new Set(["docker-compose", "compose", "stack", "yml", "yaml"]);

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

/** Dosya adından yığın adı önerir; anlamlı bir şey çıkmazsa boş döner. */
function suggestName(fileName: string): string {
  const guess = fileName
    .replace(/\.(ya?ml)$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (GENERIC_NAMES.has(guess) || !NAME_RE.test(guess)) return "";
  return guess;
}

function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

export function StackInstaller({ onInstalled }: { onInstalled: () => void }) {
  /*
    Veri KENDİ İÇİNDE çekiliyor (M3.37). Ön kontrol (`composePreflight`)
    host-helper'a bir istek atıyor ve yığın listesinin her tazelenmesinde bunu
    yapmanın anlamı yok — kurulum formu açılmadan gerekmiyor.
  */
  const t = useT();
  const [data, setData] = useState<Payload | null>(null);
  const [name, setName] = useState("");
  const [compose, setCompose] = useState("");
  const [fileInfo, setFileInfo] = useState<{ name: string; size: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [checking, setChecking] = useState(false);

  const apply = useCallback((payload: Payload) => setData(payload), []);

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        const response = await fetch("/api/appstore", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.ok) apply((await response.json()) as Payload);
        else setError(t("docker.installer.infoFailed"));
      } catch (fetchError) {
        if ((fetchError as Error)?.name !== "AbortError") setError(t("common.errors.network"));
      }
    })();

    return () => controller.abort();
  }, [apply, t]);

  // Tek bir engel bile kurulumu durdurur; uyarı ve öneriler durdurmaz.
  const blocked = (findings ?? []).some((entry) => entry.severity === "engel");
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * Kurulum öncesi ön kontrol.
   *
   * `send` KULLANILMIYOR: o fonksiyon yığın listesini tazeliyor ve
   * notice/error kutularını dolduruyor; ön kontrol ise hiçbir şeyi
   * değiştirmeyen bir okuma.
   */
  async function check(fixes: { service: string; kind: "restart" | "logging" }[] = []) {
    if (!compose.trim()) return;
    setChecking(true);
    try {
      const response = await fetch("/api/appstore", {
        method: "POST",
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: JSON.stringify({ action: "check", compose, fixes }),
      });
      const payload = await response.json();
      if (payload.ok === false) {
        setFindings([
          { severity: "engel", service: "", title: t("docker.installer.yamlUnreadable"), detail: payload.error ?? "" },
        ]);
        return;
      }
      setFindings(payload.findings as Finding[]);
      // Düzeltme uygulandıysa kutudaki metin de güncellenmeli.
      if (fixes.length > 0 && typeof payload.compose === "string") setCompose(payload.compose);
    } catch {
      setError(t("docker.installer.checkFailed"));
    } finally {
      setChecking(false);
    }
  }

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/appstore", {
        method: "POST",
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as Partial<Payload> & {
        ok?: boolean;
        error?: string;
        message?: string;
      };

      setData((prev) =>
        prev === null
          ? prev
          : {
              ...prev,
              ...(payload.stacks ? { stacks: payload.stacks } : {}),
              ...(payload.stacksRoot ? { stacksRoot: payload.stacksRoot } : {}),
            },
      );

      // Kurulum listeyi değiştirdi; Stack sekmesi kendi listesini tazelesin.
      if (response.ok && payload.ok !== false) onInstalled();

      if (!response.ok || payload.ok === false) {
        setError(payload.error ?? t("common.errors.actionFailed"));
        return false;
      }
      setNotice(payload.message ?? t("docker.installer.ok"));
      return true;
    } catch {
      setError(t("common.errors.network"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function takeFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setNotice(null);

    if (file.size > MAX_COMPOSE_BYTES) {
      setError(
        t("docker.composeImport.tooLarge", { name: file.name, size: formatSize(file.size) }),
      );
      return;
    }

    const text = await file.text();
    setCompose(text);
    setFileInfo({ name: file.name, size: file.size });
    // Kullanıcı adı zaten yazdıysa üzerine yazılmıyor.
    if (!name.trim()) setName(suggestName(file.name));
  }

  function clearFile() {
    setCompose("");
    setFileInfo(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  if (!data) {
    return (
      <div className="space-y-2">
        {error && <p className="text-sm text-danger">{error}</p>}
        {!error && <p className="text-sm text-subtle">{t("common.states.loadingInline")}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <p
          role="alert"
          className="whitespace-pre-wrap rounded-lg bg-danger/10 px-4 py-2.5 text-sm text-danger"
        >
          {error}
        </p>
      )}
      {notice && (
        <p className="whitespace-pre-wrap rounded-lg bg-ok/10 px-4 py-2.5 text-sm text-ok">
          {notice}
        </p>
      )}

      <PreflightBanner result={data.preflight} />

      {/* --- Yükleme ------------------------------------------------------ */}
      <section className="rounded-lg border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <FileCode className="size-4 text-subtle" aria-hidden />
            {t("docker.installer.uploadTitle")}
          </h2>
          <span className="ml-auto text-xs text-subtle">
            <Rich
              text={t("docker.installer.installDir")}
              values={{ path: <code className="font-mono">{data.stacksRoot}</code> }}
            />
          </span>
        </div>

        <div className="space-y-3 px-5 py-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void takeFile(e.dataTransfer.files[0]);
            }}
            className={`flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors ${
              dragging ? "border-brand bg-brand/5" : "border-line"
            }`}
          >
            <Upload className="size-6 text-subtle" aria-hidden />
            <p className="text-sm text-subtle">
              <Rich
                text={t("docker.composeImport.dropHere")}
                values={{ file: <code className="font-mono">docker-compose.yml</code> }}
              />
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".yml,.yaml,text/yaml,text/plain"
              onChange={(e) => void takeFile(e.target.files?.[0])}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand"
            >
              {t("docker.composeImport.chooseFile")}
            </button>
            {fileInfo && (
              <p className="text-xs text-subtle">
                <span className="font-mono">{fileInfo.name}</span> · {formatSize(fileInfo.size)}
                <button
                  type="button"
                  onClick={clearFile}
                  className="ml-2 underline transition-colors hover:text-ink"
                >
                  {t("docker.composeImport.clear")}
                </button>
              </p>
            )}
          </div>

          <label className="block text-sm">
            <span className="text-subtle">{t("docker.installer.stackName")}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("docker.create.namePlaceholder")}
              className={`${inputClass} font-mono`}
            />
            <span className="mt-1 block text-xs text-subtle">
              <Rich
                text={t("docker.installer.stackNameHelp")}
                values={{
                  path: (
                    <code className="font-mono">
                      {data.stacksRoot}/{name.trim() || "…"}
                    </code>
                  ),
                }}
              />
            </span>
          </label>

          <label className="block text-sm">
            <span className="text-subtle">
              {t("docker.installer.content")}
            </span>
            <textarea
              value={compose}
              onChange={(e) => {
                setCompose(e.target.value);
                setFindings(null);
              }}
              rows={16}
              spellCheck={false}
              placeholder={t("docker.installer.contentPlaceholder")}
              className={`${inputClass} font-mono text-xs leading-relaxed`}
            />
          </label>

          <p className="rounded-md bg-brand/5 px-3 py-2 text-xs leading-relaxed text-subtle">
            <Rich
              text={t("docker.installer.validateNote")}
              values={{
                cmd: <code className="font-mono">compose config</code>,
                strong: <strong>{t("docker.installer.noOverwrite")}</strong>,
              }}
            />
          </p>

          {findings !== null && <Findings findings={findings} onFix={check} busy={checking} />}

          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={checking || busy || !compose.trim()}
              onClick={() => void check()}
              className="rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand disabled:opacity-50"
            >
              {checking ? t("docker.installer.checking") : t("docker.installer.precheck")}
            </button>
            <button
              type="button"
              disabled={busy || !name.trim() || !compose.trim() || blocked}
              title={blocked ? t("docker.installer.fixBlockers") : undefined}
              onClick={async () => {
                const ok = await send({ action: "install", name: name.trim(), compose });
                if (ok) {
                  setName("");
                  setFindings(null);
                  clearFile();
                }
              }}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? t("docker.installer.installing") : t("docker.installer.install")}
            </button>
          </div>
        </div>
      </section>

    </div>
  );
}

/**
 * Host compose çalıştırmaya izin veriyor mu.
 *
 * "Sınanamadı" ayrı bir durum ve kırmızı DEĞİL: `compose.config` kapalıyken
 * dizin deseni sorulamıyor ama `compose.up` açık olabilir. Sınayamadığımız bir
 * şeyi hata gibi göstermek, uyarının kendisine olan güveni yok eder.
 */
function PreflightBanner({ result }: { result: PreflightResult }) {
  const t = useT();
  if (result.status === "ok") return null;

  const blocked = result.status === "blocked";
  const Icon = blocked ? XCircle : HelpCircle;

  return (
    <section
      className={`rounded-lg border px-4 py-3 ${
        blocked ? "border-danger/40 bg-danger/5" : "border-warn/40 bg-warn/5"
      }`}
    >
      <h2
        className={`flex items-center gap-2 text-sm font-semibold ${
          blocked ? "text-danger" : "text-warn"
        }`}
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        {blocked ? t("docker.installer.blocked") : t("docker.installer.untested")}
      </h2>
      <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-subtle">
        {result.detail}
      </p>
      {result.allowLines && (
        <>
          <p className="mt-2 text-[11px] text-subtle">
            <Rich
              text={t("docker.installer.allowConf")}
              values={{ file: <code className="font-mono">/etc/panel-helper/allow.conf</code> }}
            />
          </p>
          <pre className="mt-1 overflow-x-auto rounded border border-line bg-canvas px-3 py-2 font-mono text-[11px] leading-relaxed">
            {result.allowLines}
            {`\n\n${t("docker.installer.allowThen")}`}
          </pre>
        </>
      )}
    </section>
  );
}

const inputClass =
  "mt-1 w-full rounded-md border border-line bg-canvas px-3 py-1.5 text-sm outline-none focus:border-brand";


/**
 * Ön kontrol bulguları (M3.19).
 *
 * Üç seviye ayrı gösteriliyor çünkü kullanıcıdan istenen şey farklı: engel
 * düzeltilmeden kurulum başlamaz, uyarı bilinerek geçilir, öneri tek tıkla
 * uygulanır. Hepsini aynı kırmızı kutuya doldurmak, gerçekten kurulumu
 * durduran şeyi gürültüde kaybederdi.
 */
function Findings({
  findings,
  onFix,
  busy,
}: {
  findings: Finding[];
  onFix: (fixes: { service: string; kind: "restart" | "logging" }[]) => void;
  busy: boolean;
}) {
  const t = useT();
  if (findings.length === 0) {
    return (
      <p className="rounded-md border border-ok/40 bg-ok/5 px-3 py-2 text-xs text-ok">
        {t("docker.installer.clean")}
      </p>
    );
  }

  const style: Record<Finding["severity"], string> = {
    engel: "border-danger/40 bg-danger/5 text-danger",
    uyari: "border-warn/40 bg-warn/5 text-warn",
    oneri: "border-line bg-canvas text-subtle",
  };
  const label: Record<Finding["severity"], string> = {
    engel: t("docker.installer.severity.engel"),
    uyari: t("docker.installer.severity.uyari"),
    oneri: t("docker.installer.severity.oneri"),
  };

  return (
    <ul className="space-y-1.5">
      {findings.map((finding, index) => (
        <li
          key={`${finding.service}-${finding.title}-${index}`}
          className={`rounded-md border px-3 py-2 text-xs ${style[finding.severity]}`}
        >
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="rounded border border-current px-1 text-[10px] uppercase opacity-80">
              {label[finding.severity]}
            </span>
            <strong>{finding.title}</strong>
            {finding.service && <span className="opacity-70">· {finding.service}</span>}
          </span>
          <span className="mt-1 block leading-relaxed opacity-90">{finding.detail}</span>
          {finding.fix && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onFix([{ service: finding.service, kind: finding.fix!.kind }])}
              className="mt-1.5 rounded border border-current px-2 py-0.5 text-[11px] transition-opacity hover:opacity-80 disabled:opacity-50"
            >
              {finding.fix.label}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
