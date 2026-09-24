"use client";

import { useEffect, useState } from "react";

import { Copy, Download, FolderOpen, Tag, X } from "lucide-react";

import { Modal } from "@/components/Modal";
import { ImageLayers } from "./ImageLayers";
import { VolumeBrowser } from "./VolumeBrowser";
import { readCsrfToken } from "./detail/shared";
import { CSRF_HEADER } from "@/lib/auth/types";
import { formatBytes } from "@/lib/metrics/catalog";
import type { DockerImage, DockerVolume, ImageLayer } from "@/lib/providers/types";
import { useFormat, useT } from "@/lib/i18n/client";
import { Rich } from "@/lib/i18n/rich";
import { withHostQuery } from "@/lib/client/host";

/**
 * Image ve volume detay pencereleri (M3.24).
 *
 * Liste bir kaynağın YERİNİ söylüyordu ama NE OLDUĞUNU söylemiyordu: bir
 * image'ın 1.7 GB olması tek başına bilgi değil, o boyutun hangi katmandan
 * geldiği bilgi. Aynı şekilde bir volume'ün adı değil, host'ta nerede durduğu
 * ve içinde ne kadar veri olduğu işe yarıyor.
 */

type ImagePayload = { layers: ImageLayer[]; raw: unknown };

export function ImageDetail({
  image,
  canAct,
  onChanged,
  onClose,
}: {
  image: DockerImage;
  /** `docker.action` — etiketleme ve dışa aktarma bu izne bağlı (M3.39). */
  canAct: boolean;
  onChanged: (data: unknown) => void;
  onClose: () => void;
}) {
  const t = useT();
  const f = useFormat();
  const [data, setData] = useState<ImagePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sonuc, setSonuc] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        const response = await fetch(
          `/api/docker/resources?detail=image&id=${encodeURIComponent(image.id)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const payload = await response.json();
        if (!response.ok) setError(payload.error ?? t("docker.image.detailFailed"));
        else setData(payload as ImagePayload);
      } catch (fetchError) {
        if ((fetchError as Error)?.name !== "AbortError") setError(t("common.errors.network"));
      }
    })();

    return () => controller.abort();
  }, [image.id, t]);

  const config = (data?.raw as { Config?: Record<string, unknown> } | undefined)?.Config;

  async function etiketIslemi(action: "tag" | "untag", reference: string) {
    setBusy(true);
    setSonuc(null);
    try {
      const response = await fetch("/api/docker/resources", {
        method: "POST",
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: JSON.stringify({ action, id: image.id, reference }),
      });
      const payload = await response.json();
      if (response.ok) {
        setSonuc({ ok: true, text: payload.message ?? t("docker.image.done") });
        onChanged(payload);
      } else {
        setSonuc({ ok: false, text: payload.error ?? t("common.errors.actionFailed") });
      }
    } catch {
      setSonuc({ ok: false, text: t("common.errors.network") });
    } finally {
      setBusy(false);
    }
  }

  function etiketle() {
    const reference = prompt(t("docker.image.tagPrompt"), image.tags[0] ?? "");
    if (reference) void etiketIslemi("tag", reference.trim());
  }

  function etiketiKaldir(reference: string) {
    const sonu = image.tags.length === 1;
    const onay = sonu
      ? t("docker.image.confirmUntagLast", { tag: reference })
      : t("docker.image.confirmUntag", { tag: reference });
    if (confirm(onay)) void etiketIslemi("untag", reference);
  }

  return (
    <Modal open title={image.tags[0] ?? image.id.replace(/^sha256:/, "").slice(0, 12)} onClose={onClose} wide>
      <div className="space-y-4">
        <dl className="space-y-1.5 text-sm">
          <Satir label={t("docker.image.tags")}>
            {image.tags.length > 0 ? (
              <span className="flex flex-wrap items-center gap-1">
                {image.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 font-mono text-[11px]"
                  >
                    {tag}
                    {canAct && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => etiketiKaldir(tag)}
                        title={t("docker.image.removeTag")}
                        aria-label={t("docker.image.removeTagAria", { tag })}
                        className="text-subtle transition-colors hover:text-danger disabled:opacity-40"
                      >
                        <X className="size-3" aria-hidden />
                      </button>
                    )}
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-subtle">{t("docker.image.untagged")}</span>
            )}
          </Satir>
          <Satir label={t("docker.image.id")}>
            <span className="font-mono text-[11px]">{image.id.replace(/^sha256:/, "")}</span>
          </Satir>
          <Satir label={t("docker.image.size")}>{formatBytes(image.sizeBytes)}</Satir>
          <Satir label={t("docker.image.created")}>
            {image.createdAt > 0 ? f.dateTime(image.createdAt * 1000) : "—"}
          </Satir>
          <Satir label={t("docker.image.usedBy")}>
            {image.usedBy.length === 0 ? (
              <span className="text-warn">{t("docker.image.unused")}</span>
            ) : (
              image.usedBy.join(", ")
            )}
          </Satir>
          {image.repoDigests.length > 0 && (
            <Satir label={t("docker.image.digest")}>
              <span className="break-all font-mono text-[10px] text-subtle">
                {image.repoDigests.join(" ")}
              </span>
            </Satir>
          )}
        </dl>

        {config && (
          <section className="rounded-lg border border-line px-3 py-2.5">
            <h3 className="mb-1.5 text-sm font-semibold">{t("docker.image.runConfig")}</h3>
            <dl className="space-y-1 text-xs">
              <Satir label="Entrypoint">
                <Kod value={config.Entrypoint} />
              </Satir>
              <Satir label="Cmd">
                <Kod value={config.Cmd} />
              </Satir>
              <Satir label="WorkingDir">
                <Kod value={config.WorkingDir} />
              </Satir>
              <Satir label="User">
                <Kod value={config.User || "root"} />
              </Satir>
              <Satir label="ExposedPorts">
                <Kod value={Object.keys((config.ExposedPorts as object) ?? {})} />
              </Satir>
            </dl>
          </section>
        )}

        {canAct && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={etiketle}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-subtle transition-colors hover:border-brand hover:text-brand disabled:opacity-40"
            >
              <Tag className="size-3" aria-hidden />
              {t("docker.image.tag")}
            </button>

            {/*
              İndirme bir `<a>`: tarayıcının indirme akışına bağlanmanın tek
              yolu bu ve arşiv gigabaytlar tutabildiği için fetch ile belleğe
              almanın anlamı yok.
            */}
            <a
              href={withHostQuery(`/api/docker/resources?detail=export-image&id=${encodeURIComponent(image.id)}`)}
              className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-subtle transition-colors hover:border-brand hover:text-brand"
            >
              <Download className="size-3" aria-hidden />
              {t("docker.image.downloadTar")}
            </a>
          </div>
        )}

        {sonuc && (
          <p className={`text-xs ${sonuc.ok ? "text-ok" : "text-danger"}`}>{sonuc.text}</p>
        )}

        {canAct && (
          <p className="text-[11px] text-subtle">
            <Rich
              text={t("docker.image.nameNote")}
              values={{ name: <strong>{t("docker.image.nameWord")}</strong> }}
            />
          </p>
        )}

        <section className="rounded-lg border border-line px-3 py-2.5">
          <h3 className="mb-1.5 text-sm font-semibold">{t("docker.image.layers")}</h3>

          {error && <p className="text-sm text-danger">{error}</p>}
          {!error && !data && (
            <p className="text-sm text-subtle">{t("common.states.loadingInline")}</p>
          )}

          {data && data.layers.length === 0 && (
            <p className="text-sm text-subtle">{t("docker.image.noLayers")}</p>
          )}

          {data && data.layers.length > 0 && <ImageLayers layers={data.layers} />}
        </section>
      </div>
    </Modal>
  );
}

export function VolumeDetail({
  volume,
  sizeBytes,
  canAct,
  onChanged,
  onClose,
}: {
  volume: DockerVolume;
  sizeBytes: number | null;
  /** `docker.action` — klonlama ve dışa aktarma bu izne bağlı (M3.33). */
  canAct: boolean;
  /** Klonlama sonrası güncel kaynak listesi. */
  onChanged: (data: unknown) => void;
  onClose: () => void;
}) {
  const t = useT();
  const f = useFormat();
  const [raw, setRaw] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [dosyalar, setDosyalar] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        const response = await fetch(
          `/api/docker/resources?detail=volume&id=${encodeURIComponent(volume.name)}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (response.ok) setRaw((await response.json()).raw);
      } catch {
        // Detay alınamazsa üstteki özet yine de gösteriliyor.
      }
    })();

    return () => controller.abort();
  }, [volume.name]);

  const labels = (raw as { Labels?: Record<string, string> | null } | null)?.Labels ?? {};
  const options = (raw as { Options?: Record<string, string> | null } | null)?.Options ?? {};

  async function clone() {
    /*
      ⚠️ Kullanımdaki bir volume'ü kopyalamak, çalışan bir veritabanının
      dosyalarını o yazarken kopyalamak demek — kopya yarım bir işlemi
      yakalarsa bozuk olur. Engellemiyoruz (kullanıcı bilerek de isteyebilir)
      ama kullanan container varsa AÇIKÇA söylüyoruz.
    */
    const uyari =
      volume.usedBy.length > 0
        ? t("docker.volume.inUseWarning", { list: volume.usedBy.join(", ") })
        : "";

    const target = prompt(
      t("docker.volume.clonePrompt", { name: volume.name, warning: uyari }),
      t("docker.volume.cloneName", { name: volume.name }),
    );
    if (!target) return;

    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/docker/resources", {
        method: "POST",
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: JSON.stringify({ action: "clone", id: volume.name, target }),
      });
      const payload = await response.json();
      if (response.ok) {
        setResult({ ok: true, text: payload.message ?? t("docker.volume.cloned") });
        onChanged(payload);
      } else {
        setResult({ ok: false, text: payload.error ?? t("docker.volume.cloneFailed") });
      }
    } catch {
      setResult({ ok: false, text: t("common.errors.network") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={volume.name} onClose={onClose} wide>
      <div className="space-y-4">
        <dl className="space-y-1.5 text-sm">
          <Satir label={t("docker.volume.driver")}>{volume.driver}</Satir>
          <Satir label={t("docker.volume.hostPath")}>
            <span className="break-all font-mono text-[11px]">{volume.mountpoint}</span>
          </Satir>
          <Satir label={t("docker.volume.size")}>
            {sizeBytes === null ? (
              <span className="text-subtle">{t("docker.volume.notCalculated")}</span>
            ) : (
              formatBytes(sizeBytes)
            )}
          </Satir>
          <Satir label={t("docker.volume.created")}>
            {volume.createdAt ? f.dateTime(volume.createdAt * 1000) : "—"}
          </Satir>
          <Satir label={t("docker.volume.compose")}>{volume.composeProject ?? "—"}</Satir>
          <Satir label={t("docker.volume.usedBy")}>
            {volume.usedBy.length === 0 ? (
              <span className="text-warn">{t("docker.volume.unused")}</span>
            ) : (
              volume.usedBy.join(", ")
            )}
          </Satir>
        </dl>

        {Object.keys(options).length > 0 && (
          <section className="rounded-lg border border-line px-3 py-2.5">
            <h3 className="mb-1.5 text-sm font-semibold">{t("docker.volume.driverOptions")}</h3>
            <ul className="space-y-0.5 font-mono text-[11px]">
              {Object.entries(options).map(([key, value]) => (
                <li key={key}>
                  <span className="text-subtle">{key}=</span>
                  {value}
                </li>
              ))}
            </ul>
          </section>
        )}

        {Object.keys(labels).length > 0 && (
          <section className="rounded-lg border border-line px-3 py-2.5">
            <h3 className="mb-1.5 text-sm font-semibold">{t("docker.volume.labels")}</h3>
            <ul className="space-y-0.5 break-all font-mono text-[11px]">
              {Object.entries(labels).map(([key, value]) => (
                <li key={key}>
                  <span className="text-subtle">{key}=</span>
                  {value}
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setDosyalar((value) => !value)}
            className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-subtle transition-colors hover:border-brand hover:text-brand"
          >
            <FolderOpen className="size-3" aria-hidden />
            {dosyalar ? t("docker.volume.hideFiles") : t("docker.volume.showFiles")}
          </button>

          {canAct && (
            <>
              <button
                type="button"
                onClick={() => void clone()}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-subtle transition-colors hover:border-brand hover:text-brand disabled:opacity-40"
              >
                <Copy className="size-3" aria-hidden />
                {busy ? t("docker.volume.cloning") : t("docker.volume.clone")}
              </button>

              {/*
                İndirme bir `<a>`: tarayıcının indirme akışına bağlanmanın tek
                yolu bu ve arşiv büyük olabildiği için akışı fetch ile belleğe
                almanın anlamı yok.
              */}
              <a
                href={withHostQuery(`/api/docker/resources?detail=export&id=${encodeURIComponent(volume.name)}`)}
                className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-subtle transition-colors hover:border-brand hover:text-brand"
              >
                <Download className="size-3" aria-hidden />
                {t("docker.image.downloadTar")}
              </a>
            </>
          )}
        </div>

        {result && (
          <p className={`text-xs ${result.ok ? "text-ok" : "text-danger"}`}>{result.text}</p>
        )}

        {dosyalar && (
          <section className="rounded-lg border border-line px-3 py-2.5">
            <h3 className="mb-2 text-sm font-semibold">{t("docker.volume.files")}</h3>
            <VolumeBrowser volume={volume.name} canAct={canAct} />
          </section>
        )}

        <p className="text-xs text-warn">
          {t("docker.volume.deleteWarning")}
        </p>
      </div>
    </Modal>
  );
}

function Satir({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="w-28 shrink-0 text-xs text-subtle">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

/** Dizi ya da dizeyi tek biçimde basar; tanımsızsa tire. */
function Kod({ value }: { value: unknown }) {
  if (value === undefined || value === null) return <span className="text-subtle">—</span>;
  const text = Array.isArray(value) ? value.join(" ") : String(value);
  if (!text) return <span className="text-subtle">—</span>;
  return <code className="break-all font-mono text-[11px]">{text}</code>;
}
