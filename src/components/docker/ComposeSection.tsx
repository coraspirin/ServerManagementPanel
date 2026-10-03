"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Eye,
  EyeOff,
  Info,
  Network,
  Plus,
  RotateCcw,
  RotateCw,
  ShieldAlert,
  Trash2,
  Wrench,
} from "lucide-react";

import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import type { Finding } from "@/lib/compose/checks";
import type { ComposeLocation } from "@/lib/compose/locate";
import type { PortSpec } from "@/lib/compose/ports";
import type { ServiceConfig } from "@/lib/compose/service";
import { isSecretName } from "@/lib/text";
import { useT } from "@/lib/i18n/client";
import { Rich } from "@/lib/i18n/rich";

/**
 * Container popup'ındaki compose ayarları (M3.19, M3.21'de tamamlandı).
 *
 * ⚠️ BURADA CONTAINER DEĞİL, COMPOSE DOSYASI DÜZENLENİYOR — ve bu, kullanıcıya
 * da açıkça söyleniyor. M1.8'de port/env düzenlemesinin Docker API'siyle
 * yapılması bilerek reddedilmişti çünkü compose ile yönetilen bir container'da
 * o değişiklik ilk `compose up`'ta geri alınır. Dosyayı düzenlemek, aynı
 * düğmenin kalıcı çalışan hâli.
 *
 * Kaydetmeden önce DAİMA önizleme: kullanıcı, panelin dosyasında ne
 * değiştirdiğini satır satır görmeden onaylamıyor. Denetlenemeyen bir
 * düzenleyiciye compose dosyası emanet edilmez.
 *
 * M3.19'da ağ ve ortam değişkeni bölümleri YAZILMADAN kaldı: arka uç hazırdı,
 * arayüzden çağıran yoktu. passbolt olayı ayrıca üç kusur gösterdi — dolu port
 * yalnızca "uyarı"ydı, `compose up` başarısız olunca yığının durduğu
 * anlaşılmıyordu ve yedeğe dönmenin panelde yolu yoktu. Hepsi burada kapandı.
 */

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

type AvailableNetwork = { name: string; driver: string; composeProject: string | null };
type EnvEntry = { key: string; value: string };

type Payload = {
  location: ComposeLocation;
  service: ServiceConfig;
  findings: Finding[];
  dockerPublished: number[];
  availableNetworks: AvailableNetwork[];
  /** Doluysa `networks` düzenlenemez — compose'da ikisi bir arada olamaz. */
  networkMode: string;
  backups: string[];
  text: string;
};

/** Bulgu seviyesinin rengi. Adı dil dosyasında: `docker.compose.severity.<seviye>`. */
export const SEVERITY_CLASS: Record<Finding["severity"], string> = {
  engel: "border-danger/40 bg-danger/10 text-danger",
  uyari: "border-warn/40 bg-warn/10 text-warn",
  oneri: "border-line bg-canvas text-subtle",
};

/** Cümle içindeki dosya yolu, komut ve anahtar adları — çevrilmez. */
const code = (text: string) => <code className="font-mono">{text}</code>;

/** Basit satır karşılaştırması — kaydedilecek değişikliği göstermeye yeter. */
export function diffLines(before: string, after: string): { sign: " " | "-" | "+"; text: string }[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const out: { sign: " " | "-" | "+"; text: string }[] = [];

  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ sign: " ", text: a[i] });
      i += 1;
      j += 1;
      continue;
    }
    // Eşleşmeyen bloğun sonunu bul: sonraki ortak satıra kadar.
    const nextMatch = b.indexOf(a[i] ?? " ", j);
    if (i < a.length && nextMatch === -1) {
      out.push({ sign: "-", text: a[i] });
      i += 1;
      continue;
    }
    while (j < nextMatch) {
      out.push({ sign: "+", text: b[j] });
      j += 1;
    }
    if (i >= a.length) {
      while (j < b.length) {
        out.push({ sign: "+", text: b[j] });
        j += 1;
      }
    }
  }

  // Değişmeyen uzun blokları kırp: değişikliğin etrafında üç satır yeter.
  const ilgili = new Set<number>();
  out.forEach((line, index) => {
    if (line.sign === " ") return;
    for (let k = index - 3; k <= index + 3; k += 1) ilgili.add(k);
  });

  return out.filter((_, index) => ilgili.has(index));
}

export function ComposeSection({
  containerId,
  composeProject,
  canAct,
  only,
}: {
  containerId: string;
  composeProject: string | null;
  canAct: boolean;
  /**
   * Yalnızca bir bölüm (Ortam / Ağ sekmeleri). Kaydetme, önizleme, yedek ve
   * `compose up` akışı aynen geçerli; gönderilen gövde yalnızca o alanı
   * taşıyor. Düzenlemenin tek doğru yolu burada kalsın diye ayrı bir
   * düzenleyici yazılmadı.
   */
  only?: "environment" | "networks";
}) {
  const t = useT();
  const title = t(
    only === "environment"
      ? "docker.compose.onlyEnvTitle"
      : only === "networks"
        ? "docker.compose.onlyNetTitle"
        : "docker.compose.title",
  );
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [stackDown, setStackDown] = useState<{ message: string; backup: string | null } | null>(
    null,
  );
  const [ports, setPorts] = useState<PortSpec[]>([]);
  const [networks, setNetworks] = useState<string[]>([]);
  const [environment, setEnvironment] = useState<EnvEntry[]>([]);
  const [restart, setRestart] = useState("");
  const [yeniAg, setYeniAg] = useState("");
  const [preview, setPreview] = useState<{ before: string; after: string } | null>(null);

  // Gelen yükü state'e dağıtan tek yer — ilk okuma ile "yenile" düğmesi aynı
  // kodu paylaşsın diye ayrıldı.
  const apply = useCallback((payload: Payload) => {
    setData(payload);
    setPorts(payload.service.ports);
    setNetworks(payload.service.networks);
    setEnvironment(payload.service.environment);
    setRestart(payload.service.restart);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(`/api/docker/${encodeURIComponent(containerId)}/compose`, {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? t("docker.compose.loadFailed"));
        return;
      }
      apply(payload as Payload);
    } catch {
      setError(t("common.errors.network"));
    }
  }, [containerId, apply, t]);

  // İlk okuma efekt içinde ASENKRON başlıyor: senkron bir setState çağrısı
  // React'in efekt kuralını ihlal ediyor (dosyadaki diğer efektlerle aynı
  // kalıp — bkz. detail/useDetail.ts).
  useEffect(() => {
    if (!composeProject) return;
    const controller = new AbortController();

    (async () => {
      try {
        const response = await fetch(`/api/docker/${encodeURIComponent(containerId)}/compose`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) setError(payload.error ?? t("docker.compose.loadFailed"));
        else apply(payload as Payload);
      } catch (fetchError) {
        if ((fetchError as Error)?.name !== "AbortError") setError(t("common.errors.network"));
      }
    })();

    return () => controller.abort();
  }, [containerId, composeProject, apply, t]);

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

      // `compose up` başarısız olduysa yığın DURUYOR — bu, sıradan bir hata
      // metniyle geçiştirilemez. passbolt'ta kullanıcı kırmızı satırı gördü
      // ama yığının tamamen durduğunu fark etmedi.
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

  if (!composeProject) {
    return (
      <Wrapper title={title}>
        <p className="text-sm text-subtle">{t("docker.compose.notCompose")}</p>
      </Wrapper>
    );
  }

  if (error && !data) {
    return (
      <Wrapper title={title}>
        <p className="text-sm text-warn">{error}</p>
      </Wrapper>
    );
  }

  if (!data) {
    return (
      <Wrapper title={title}>
        <p className="text-sm text-subtle">{t("common.states.loadingInline")}</p>
      </Wrapper>
    );
  }

  const changed = {
    ports: JSON.stringify(ports) !== JSON.stringify(data.service.ports),
    networks: JSON.stringify(networks) !== JSON.stringify(data.service.networks),
    environment: JSON.stringify(environment) !== JSON.stringify(data.service.environment),
    restart: restart !== data.service.restart,
  };
  const degisti = only
    ? changed[only]
    : changed.ports || changed.networks || changed.environment || changed.restart;

  // Önizleme ve kaydetme AYNI alanları göndermeli; ikisinin ayrışması,
  // kullanıcının onayladığı diff'ten başka bir şeyin yazılması demek olurdu.
  // Tek bölüm modunda yalnızca o alan: diğer sekmede yarım kalmış bir
  // düzenleme buradan yanlışlıkla yazılmasın.
  const govde =
    only === "environment"
      ? { environment }
      : only === "networks"
        ? { networks }
        : { ports, networks, environment, restart };

  // `blocked()` ile aynı ölçüt; modülü değer olarak içe aktarmak denetim
  // kodunu (ve sunucu çeviri katmanını) istemci paketine taşırdı.
  const engelli = data.findings.some((finding) => finding.severity === "engel");

  // Serviste yazan ama Docker'da henüz olmayan ağlar da listede görünmeli:
  // compose onları kendisi yaratacak, kullanıcı işareti kaldırabilmeli.
  const tumAglar = Array.from(
    new Set([...data.availableNetworks.map((entry) => entry.name), ...networks]),
  ).sort();

  return (
    <Wrapper
      title={title}
      action={
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          className="rounded border border-line p-1.5 text-subtle transition-colors hover:text-brand disabled:opacity-50"
          title={t("docker.compose.reload")}
        >
          <RotateCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} />
        </button>
      }
    >
      <p className="mb-3 flex items-start gap-1.5 text-xs text-subtle">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          <Rich
            text={t("docker.compose.intro")}
            values={{
              emph: <strong>{t("docker.compose.introEmph")}</strong>,
              file: code(data.location.file),
              service: code(data.location.service),
              cmd: code("compose up"),
            }}
          />
          {data.location.allFiles.length > 1 && (
            <>
              {" "}
              {t("docker.compose.multiFile", { count: data.location.allFiles.length })}
            </>
          )}
        </span>
      </p>

      {stackDown && (
        <StackDownBanner
          detail={stackDown}
          busy={busy}
          canAct={canAct}
          onRestore={async (backup) => {
            const result = await send({ action: "restore", backup });
            if (!result) return;
            setStackDown(null);
            setNotice(result.message ?? t("docker.compose.restored"));
            await load();
          }}
          onDismiss={() => setStackDown(null)}
        />
      )}

      {error && <p className="mb-2 rounded bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      {notice && (
        <p className="mb-2 whitespace-pre-wrap rounded bg-ok/10 px-3 py-2 text-sm text-ok">
          {notice}
        </p>
      )}

      {data.findings.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {data.findings.map((finding, index) => (
            <li
              key={`${finding.service}-${finding.title}-${index}`}
              className={`rounded border px-2.5 py-1.5 text-xs ${SEVERITY_CLASS[finding.severity]}`}
            >
              <span className="flex flex-wrap items-center gap-1.5">
                {finding.severity !== "oneri" && (
                  <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                )}
                <strong>{finding.title}</strong>
                {finding.service && <span className="opacity-70">· {finding.service}</span>}
                {/*
                  Satır numarası (M3.34): iki yüz satırlık bir dosyada "web
                  servisinde restart yok" demek, kullanıcıyı o satırı aramaya
                  bırakmaktı. Konum bilgisi `yaml` düğümlerinde zaten vardı.
                */}
                {finding.line !== undefined && (
                  <span className="opacity-70">
                    · {t("docker.compose.line", { line: finding.line })}
                  </span>
                )}
              </span>
              <span className="mt-0.5 block opacity-90">{finding.detail}</span>
              {finding.fix && canAct && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    const result = await send({
                      fixes: [{ service: finding.service, kind: finding.fix!.kind }],
                      preview: true,
                    });
                    if (result) setPreview({ before: result.before, after: result.text });
                  }}
                  className="mt-1.5 flex items-center gap-1 rounded border border-line px-2 py-0.5 text-[11px] transition-colors hover:border-brand disabled:opacity-50"
                >
                  <Wrench className="size-3" /> {finding.fix.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!only && (
      <div className="space-y-2">
        <p className="text-xs font-medium text-subtle">{t("docker.compose.ports")}</p>
        {ports.length === 0 && (
          <p className="text-xs text-subtle">{t("docker.compose.noPorts")}</p>
        )}

        {ports.map((port, index) => (
          <PortRow
            key={index}
            port={port}
            published={data.dockerPublished.includes(port.published ?? -1)}
            disabled={!canAct || busy}
            onChange={(next) =>
              setPorts(ports.map((entry, i) => (i === index ? next : entry)))
            }
            onRemove={() => setPorts(ports.filter((_, i) => i !== index))}
          />
        ))}

        {canAct && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              setPorts([
                ...ports,
                { published: null, target: 80, protocol: "tcp", hostIp: "", form: "short", raw: null },
              ])
            }
            className="flex items-center gap-1 rounded border border-line px-2 py-1 text-xs transition-colors hover:border-brand disabled:opacity-50"
          >
            <Plus className="size-3" /> {t("docker.compose.addPort")}
          </button>
        )}
      </div>
      )}

      {only !== "environment" && (
      <div className={`${only ? "" : "mt-4 "}space-y-2`}>
        <p className="flex items-center gap-1.5 text-xs font-medium text-subtle">
          <Network className="size-3.5" aria-hidden /> {t("docker.compose.networks")}
        </p>

        {data.networkMode ? (
          <p className="rounded border border-warn/40 bg-warn/10 px-2.5 py-1.5 text-xs text-warn">
            <Rich
              text={t("docker.compose.networkModeLocked")}
              values={{
                mode: code(`network_mode: ${data.networkMode}`),
                nm: code("network_mode"),
                nets: code("networks"),
              }}
            />
          </p>
        ) : (
          <>
            {tumAglar.length === 0 && (
              <p className="text-xs text-subtle">{t("docker.compose.noNetworks")}</p>
            )}

            <div className="flex flex-wrap gap-1.5">
              {tumAglar.map((name) => {
                const secili = networks.includes(name);
                const dockerda = data.availableNetworks.some((entry) => entry.name === name);

                return (
                  <label
                    key={name}
                    className={`flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 text-xs transition-colors ${
                      secili ? "border-brand bg-brand/10 text-brand" : "border-line text-subtle"
                    } ${!canAct || busy ? "pointer-events-none opacity-50" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={secili}
                      disabled={!canAct || busy}
                      onChange={() =>
                        setNetworks(
                          secili
                            ? networks.filter((entry) => entry !== name)
                            : [...networks, name],
                        )
                      }
                      className="size-3 accent-current"
                    />
                    <span className="font-mono">{name}</span>
                    {!dockerda && (
                      <span
                        className="text-[10px] opacity-70"
                        title={t("docker.compose.notInDocker")}
                      >
                        {t("docker.compose.willCreate")}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>

            {canAct && (
              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  value={yeniAg}
                  onChange={(event) => setYeniAg(event.target.value)}
                  placeholder={t("docker.compose.newNetworkPlaceholder")}
                  disabled={busy}
                  className="w-40 rounded border border-line bg-canvas px-2 py-1 font-mono text-xs outline-none focus:border-brand disabled:opacity-50"
                />
                <button
                  type="button"
                  disabled={busy || !yeniAg.trim() || networks.includes(yeniAg.trim())}
                  onClick={() => {
                    setNetworks([...networks, yeniAg.trim()]);
                    setYeniAg("");
                  }}
                  className="flex items-center gap-1 rounded border border-line px-2 py-1 text-xs transition-colors hover:border-brand disabled:opacity-50"
                >
                  <Plus className="size-3" /> {t("docker.compose.addNetwork")}
                </button>
              </div>
            )}

            <p className="text-[11px] text-subtle">
              <Rich
                text={t("docker.compose.networkExtrasKept")}
                values={{
                  aliases: code("aliases"),
                  ipv4: code("ipv4_address"),
                  kept: <strong>{t("docker.compose.keptWord")}</strong>,
                }}
              />
            </p>
          </>
        )}
      </div>
      )}

      {only !== "networks" && (
        <EnvEditor entries={environment} disabled={!canAct || busy} onChange={setEnvironment} />
      )}

      {!only && (
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="text-xs text-subtle">{t("docker.compose.restartPolicy")}</label>
        <select
          value={restart}
          disabled={!canAct || busy}
          onChange={(event) => setRestart(event.target.value)}
          className="rounded-md border border-line bg-canvas px-2 py-1 text-xs outline-none focus:border-brand disabled:opacity-50"
        >
          <option value="">{t("docker.compose.notSet")}</option>
          <option value="no">no</option>
          <option value="always">always</option>
          <option value="unless-stopped">unless-stopped</option>
          <option value="on-failure">on-failure</option>
        </select>
      </div>
      )}

      {canAct && degisti && !preview && (
        <div className="mt-3 space-y-2">
          {engelli && (
            <p className="flex items-start gap-1.5 rounded border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-xs text-danger">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                <Rich
                  text={t("docker.compose.blockerWarning")}
                  values={{
                    blocker: <strong>{t("docker.compose.severity.engel")}</strong>,
                    cmd: code("compose up"),
                  }}
                />
              </span>
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || engelli}
              onClick={async () => {
                const result = await send({ ...govde, preview: true });
                if (result) setPreview({ before: result.before, after: result.text });
              }}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {t("docker.compose.review")}
            </button>

            {engelli && (
              <button
                type="button"
                disabled={busy}
                title={t("docker.compose.writeOnlyTitle")}
                onClick={async () => {
                  const result = await send({ ...govde, restartStack: false });
                  if (!result) return;
                  setNotice(result.message ?? t("docker.compose.writtenNotStarted"));
                  await load();
                }}
                className="rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:text-ink disabled:opacity-50"
              >
                {t("docker.compose.writeOnly")}
              </button>
            )}
          </div>
        </div>
      )}

      {preview && (
        <div className="mt-3 rounded-lg border border-line">
          <p className="border-b border-line px-3 py-2 text-xs text-subtle">
            <Rich text={t("docker.compose.previewIntro")} values={{ cmd: code("compose config") }} />
          </p>
          <pre className="max-h-56 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed">
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
          <div className="flex flex-wrap gap-2 border-t border-line px-3 py-2">
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="rounded-md border border-line px-3 py-1.5 text-sm"
            >
              {t("common.actions.cancel")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const result = await send(govde);
                // `stackDown` durumunda `send` null döner ama bant zaten
                // çizildi; önizlemeyi kapatmak, kullanıcının bandı görmesini
                // engelleyen üst üste binmeyi önlüyor.
                setPreview(null);
                if (!result) return;
                setNotice(
                  [
                    result.message,
                    result.warnings &&
                      t("docker.compose.composeWarning", { warnings: result.warnings }),
                  ]
                    .filter(Boolean)
                    .join("\n\n"),
                );
                await load();
              }}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {t("docker.compose.saveApply")}
            </button>
          </div>
        </div>
      )}

      {!only && (
      <p className="mt-3 text-xs text-subtle">
        <Rich
          text={t("docker.compose.firewallNote")}
          values={{
            firewall: (
              <Link href="/firewall" className="underline underline-offset-2">
                {t("docker.compose.firewallLink")}
              </Link>
            ),
            ports: (
              <Link href="/ports" className="underline underline-offset-2">
                {t("docker.compose.portsLink")}
              </Link>
            ),
          }}
        />
      </p>
      )}
    </Wrapper>
  );
}

/**
 * `compose up` başarısız olduğunda çıkan bant (M3.21).
 *
 * Ayrı bir bileşen, çünkü söylediği şey diğer hatalardan farklı: dosya
 * değişti, GEÇERLİ, ama yığın ayakta değil. Tek tıkla dönülebilecek bir yedek
 * olmadan bu ekran kullanıcıyı sunucuda elle uğraşmaya bırakırdı — passbolt'ta
 * tam olarak bu oldu.
 */
function StackDownBanner({
  detail,
  busy,
  canAct,
  onRestore,
  onDismiss,
}: {
  detail: { message: string; backup: string | null };
  busy: boolean;
  canAct: boolean;
  onRestore: (backup: string) => void | Promise<void>;
  onDismiss: () => void;
}) {
  const t = useT();

  return (
    <div className="mb-3 rounded-lg border border-danger bg-danger/10 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-danger">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        {t("docker.compose.stackDown")}
      </p>

      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-danger/30 bg-canvas p-2 font-mono text-[11px]">
        {detail.message}
      </pre>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {canAct && detail.backup && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onRestore(detail.backup!)}
            className="flex items-center gap-1.5 rounded-md border border-danger px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
          >
            <RotateCcw className="size-3.5" /> {t("docker.compose.restoreStart")}
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md border border-line px-3 py-1.5 text-xs text-subtle transition-colors hover:text-ink"
        >
          {t("common.actions.close")}
        </button>
        {detail.backup && (
          <span className="font-mono text-[11px] text-subtle">
            {t("docker.compose.backupLabel", { name: detail.backup })}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Ortam değişkeni düzenleyici (M3.21).
 *
 * Sır taşıyan değerler VARSAYILAN OLARAK maskeli — detay penceresindeki
 * `EnvTab` ile aynı gerekçe: bu ekran omuz üstünden okunabilir, yansıtılabilir,
 * ekran görüntüsü alınabilir. Maskeleme ada bakıyor (`isSecretName`), değere
 * değil; ölçüt eksik yakalayabileceği için uyarı metni de duruyor.
 */
function EnvEditor({
  entries,
  disabled,
  onChange,
}: {
  entries: EnvEntry[];
  disabled: boolean;
  onChange: (next: EnvEntry[]) => void;
}) {
  const t = useT();
  const [shown, setShown] = useState<Set<number>>(new Set());

  const toggle = (index: number) =>
    setShown((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return (
    <div className="mt-4 space-y-2">
      <p className="text-xs font-medium text-subtle">{t("docker.compose.envTitle")}</p>

      {entries.length === 0 && (
        <p className="text-xs text-subtle">{t("docker.compose.noEnv")}</p>
      )}

      {entries.map((entry, index) => {
        const sirli = isSecretName(entry.key);
        const gizli = sirli && !shown.has(index);

        return (
          <div key={index} className="flex flex-wrap items-center gap-1.5 text-xs">
            <input
              value={entry.key}
              disabled={disabled}
              placeholder={t("docker.compose.keyPlaceholder")}
              onChange={(event) =>
                onChange(
                  entries.map((item, i) =>
                    i === index ? { ...item, key: event.target.value } : item,
                  ),
                )
              }
              className="w-44 rounded border border-line bg-canvas px-2 py-1 font-mono outline-none focus:border-brand disabled:opacity-50"
            />
            <span className="text-subtle">=</span>
            <input
              value={entry.value}
              type={gizli ? "password" : "text"}
              disabled={disabled}
              placeholder={t("docker.compose.valuePlaceholder")}
              onChange={(event) =>
                onChange(
                  entries.map((item, i) =>
                    i === index ? { ...item, value: event.target.value } : item,
                  ),
                )
              }
              className="min-w-0 flex-1 rounded border border-line bg-canvas px-2 py-1 font-mono outline-none focus:border-brand disabled:opacity-50"
            />
            {sirli && (
              <button
                type="button"
                onClick={() => toggle(index)}
                title={gizli ? t("docker.compose.show") : t("docker.compose.hide")}
                className="rounded border border-line p-1 text-subtle transition-colors hover:text-brand"
              >
                {gizli ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
              </button>
            )}
            {!disabled && (
              <button
                type="button"
                onClick={() => onChange(entries.filter((_, i) => i !== index))}
                title={t("docker.compose.removeVar")}
                className="rounded border border-line p-1 text-subtle transition-colors hover:text-danger"
              >
                <Trash2 className="size-3" />
              </button>
            )}
          </div>
        );
      })}

      {!disabled && (
        <button
          type="button"
          onClick={() => onChange([...entries, { key: "", value: "" }])}
          className="flex items-center gap-1 rounded border border-line px-2 py-1 text-xs transition-colors hover:border-brand"
        >
          <Plus className="size-3" /> {t("docker.compose.addVar")}
        </button>
      )}

      <p className="text-[11px] text-warn">
        <Rich
          text={t("docker.compose.envWarning")}
          values={{
            name: <strong>{t("docker.compose.envWarningName")}</strong>,
            ref: code(t("docker.compose.envRefExample")),
          }}
        />
      </p>
    </div>
  );
}

function PortRow({
  port,
  published,
  disabled,
  onChange,
  onRemove,
}: {
  port: PortSpec;
  published: boolean;
  disabled: boolean;
  onChange: (next: PortSpec) => void;
  onRemove: () => void;
}) {
  const t = useT();

  // Ayrıştırılamayan satırlar (aralık, ${DEĞİŞKEN}) düzenlemeye kapalı:
  // neyi değiştirdiğini bilmediğimiz bir satırı değiştirmemeliyiz.
  if (port.raw !== null) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <code className="flex-1 rounded border border-line bg-canvas px-2 py-1 font-mono">
          {port.raw}
        </code>
        <span className="text-subtle">{t("docker.compose.notEditable")}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <input
        type="number"
        value={port.published ?? ""}
        placeholder={t("docker.compose.noPublish")}
        disabled={disabled}
        onChange={(event) =>
          onChange({
            ...port,
            published: event.target.value === "" ? null : Number(event.target.value),
          })
        }
        className="w-24 rounded border border-line bg-canvas px-2 py-1 font-mono outline-none focus:border-brand disabled:opacity-50"
      />
      <span className="text-subtle">→</span>
      <input
        type="number"
        value={port.target}
        disabled={disabled}
        onChange={(event) => onChange({ ...port, target: Number(event.target.value) })}
        className="w-20 rounded border border-line bg-canvas px-2 py-1 font-mono outline-none focus:border-brand disabled:opacity-50"
      />
      <select
        value={port.protocol}
        disabled={disabled}
        onChange={(event) =>
          onChange({ ...port, protocol: event.target.value === "udp" ? "udp" : "tcp" })
        }
        className="rounded border border-line bg-canvas px-1.5 py-1 outline-none focus:border-brand disabled:opacity-50"
      >
        <option value="tcp">tcp</option>
        <option value="udp">udp</option>
      </select>
      {published && (
        <span
          className="rounded border border-line px-1 text-[10px] text-subtle"
          title={t("docker.compose.publishedTitle")}
        >
          {t("docker.compose.published")}
        </span>
      )}
      {!disabled && (
        <button
          type="button"
          onClick={onRemove}
          title={t("docker.compose.removePort")}
          className="rounded border border-line p-1 text-subtle transition-colors hover:text-danger"
        >
          <Trash2 className="size-3" />
        </button>
      )}
    </div>
  );
}

function Wrapper({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line bg-surface px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}
