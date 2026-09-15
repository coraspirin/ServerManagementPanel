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
        if (!response.ok) setError(payload.error ?? "Detay alınamadı.");
        else setData(payload as ImagePayload);
      } catch (fetchError) {
        if ((fetchError as Error)?.name !== "AbortError") setError("Sunucuya ulaşılamadı.");
      }
    })();

    return () => controller.abort();
  }, [image.id]);

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
        setSonuc({ ok: true, text: payload.message ?? "Tamam." });
        onChanged(payload);
      } else {
        setSonuc({ ok: false, text: payload.error ?? "İşlem başarısız." });
      }
    } catch {
      setSonuc({ ok: false, text: "Sunucuya ulaşılamadı." });
    } finally {
      setBusy(false);
    }
  }

  function etiketle() {
    const reference = prompt(
      "Yeni etiket (örn. `uygulama:1.2` ya da `ghcr.io/kullanici/uygulama:latest`):\n\n" +
        "Docker'da imajın ADI yoktur, etiketleri vardır — bu işlem var olan etiketleri " +
        "KALDIRMAZ, yenisini ekler. Ad değiştirmek istiyorsan önce yenisini ekle, sonra " +
        "eskisini kaldır.",
      image.tags[0] ?? "",
    );
    if (reference) void etiketIslemi("tag", reference.trim());
  }

  function etiketiKaldir(reference: string) {
    const sonu = image.tags.length === 1;
    const onay = sonu
      ? `"${reference}" imajın SON etiketi.\n\n` +
        "Kaldırmak imajı etiketsiz (sarkan) bırakır ve bir sonraki temizlikte silinir. " +
        "Devam edilsin mi?"
      : `"${reference}" etiketi kaldırılsın mı?\n\nİmaj diğer etiketleriyle kalmaya devam eder.`;
    if (confirm(onay)) void etiketIslemi("untag", reference);
  }

  return (
    <Modal open title={image.tags[0] ?? image.id.replace(/^sha256:/, "").slice(0, 12)} onClose={onClose} wide>
      <div className="space-y-4">
        <dl className="space-y-1.5 text-sm">
          <Satir label="Etiketler">
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
                        title="Bu etiketi kaldır"
                        aria-label={`${tag} etiketini kaldır`}
                        className="text-subtle transition-colors hover:text-danger disabled:opacity-40"
                      >
                        <X className="size-3" aria-hidden />
                      </button>
                    )}
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-subtle">etiketsiz (sarkan)</span>
            )}
          </Satir>
          <Satir label="ID">
            <span className="font-mono text-[11px]">{image.id.replace(/^sha256:/, "")}</span>
          </Satir>
          <Satir label="Boyut">{formatBytes(image.sizeBytes)}</Satir>
          <Satir label="Oluşturma">
            {image.createdAt > 0
              ? new Date(image.createdAt * 1000).toLocaleString("tr-TR")
              : "—"}
          </Satir>
          <Satir label="Kullanan">
            {image.usedBy.length === 0 ? (
              <span className="text-warn">hiçbir container kullanmıyor</span>
            ) : (
              image.usedBy.join(", ")
            )}
          </Satir>
          {image.repoDigests.length > 0 && (
            <Satir label="Digest">
              <span className="break-all font-mono text-[10px] text-subtle">
                {image.repoDigests.join(" ")}
              </span>
            </Satir>
          )}
        </dl>

        {config && (
          <section className="rounded-lg border border-line px-3 py-2.5">
            <h3 className="mb-1.5 text-sm font-semibold">Çalıştırma yapılandırması</h3>
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
              Etiketle
            </button>

            {/*
              İndirme bir `<a>`: tarayıcının indirme akışına bağlanmanın tek
              yolu bu ve arşiv gigabaytlar tutabildiği için fetch ile belleğe
              almanın anlamı yok.
            */}
            <a
              href={`/api/docker/resources?detail=export-image&id=${encodeURIComponent(image.id)}`}
              className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-subtle transition-colors hover:border-brand hover:text-brand"
            >
              <Download className="size-3" aria-hidden />
              Tar olarak indir
            </a>
          </div>
        )}

        {sonuc && (
          <p className={`text-xs ${sonuc.ok ? "text-ok" : "text-danger"}`}>{sonuc.text}</p>
        )}

        {canAct && (
          <p className="text-[11px] text-subtle">
            Docker&apos;da imajın <strong>adı</strong> yoktur, etiketleri vardır. &quot;Ad
            değiştirmek&quot; iki adımdır: yenisini ekle, sonra eskisini kaldır — panel
            ikisini ayrı tutuyor ki arada bir şey ters giderse ne olduğu görünsün.
          </p>
        )}

        <section className="rounded-lg border border-line px-3 py-2.5">
          <h3 className="mb-1.5 text-sm font-semibold">Katmanlar</h3>

          {error && <p className="text-sm text-danger">{error}</p>}
          {!error && !data && <p className="text-sm text-subtle">yükleniyor…</p>}

          {data && data.layers.length === 0 && (
            <p className="text-sm text-subtle">
              Katman geçmişi yok — uzak bir kayıt defterinden çekilen image&apos;larda
              Docker ara katmanların komutlarını saklamaz.
            </p>
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
        ? `

⚠️ Bu volume şu an kullanılıyor: ${volume.usedBy.join(", ")}. ` +
          "Çalışan bir uygulama yazarken alınan kopya tutarsız olabilir; " +
          "tutarlı bir kopya için önce container'ı durdurman gerekir."
        : "";

    const target = prompt(
      `"${volume.name}" volume'ünün kopyası hangi adla oluşturulsun?${uyari}`,
      `${volume.name}-kopya`,
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
        setResult({ ok: true, text: payload.message ?? "Kopyalandı." });
        onChanged(payload);
      } else {
        setResult({ ok: false, text: payload.error ?? "Kopyalama başarısız." });
      }
    } catch {
      setResult({ ok: false, text: "Sunucuya ulaşılamadı." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={volume.name} onClose={onClose} wide>
      <div className="space-y-4">
        <dl className="space-y-1.5 text-sm">
          <Satir label="Sürücü">{volume.driver}</Satir>
          <Satir label="Host yolu">
            <span className="break-all font-mono text-[11px]">{volume.mountpoint}</span>
          </Satir>
          <Satir label="Boyut">
            {sizeBytes === null ? (
              <span className="text-subtle">
                hesaplanmadı — listedeki &quot;Boyutları hesapla&quot; düğmesi
              </span>
            ) : (
              formatBytes(sizeBytes)
            )}
          </Satir>
          <Satir label="Oluşturma">
            {volume.createdAt
              ? new Date(volume.createdAt * 1000).toLocaleString("tr-TR")
              : "—"}
          </Satir>
          <Satir label="Compose">{volume.composeProject ?? "—"}</Satir>
          <Satir label="Kullanan">
            {volume.usedBy.length === 0 ? (
              <span className="text-warn">
                hiçbir container kullanmıyor — durmuş container&apos;lar dahil
              </span>
            ) : (
              volume.usedBy.join(", ")
            )}
          </Satir>
        </dl>

        {Object.keys(options).length > 0 && (
          <section className="rounded-lg border border-line px-3 py-2.5">
            <h3 className="mb-1.5 text-sm font-semibold">Sürücü seçenekleri</h3>
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
            <h3 className="mb-1.5 text-sm font-semibold">Etiketler</h3>
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
            {dosyalar ? "Dosyaları gizle" : "Dosyaları göster"}
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
                {busy ? "kopyalanıyor…" : "Klonla"}
              </button>

              {/*
                İndirme bir `<a>`: tarayıcının indirme akışına bağlanmanın tek
                yolu bu ve arşiv büyük olabildiği için akışı fetch ile belleğe
                almanın anlamı yok.
              */}
              <a
                href={`/api/docker/resources?detail=export&id=${encodeURIComponent(volume.name)}`}
                className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-subtle transition-colors hover:border-brand hover:text-brand"
              >
                <Download className="size-3" aria-hidden />
                Tar olarak indir
              </a>
            </>
          )}
        </div>

        {result && (
          <p className={`text-xs ${result.ok ? "text-ok" : "text-danger"}`}>{result.text}</p>
        )}

        {dosyalar && (
          <section className="rounded-lg border border-line px-3 py-2.5">
            <h3 className="mb-2 text-sm font-semibold">Dosyalar</h3>
            <VolumeBrowser volume={volume.name} canAct={canAct} />
          </section>
        )}

        <p className="text-xs text-warn">
          Bu volume&apos;ü silmek İÇİNDEKİ VERİYİ siler ve geri getirilemez. Host yolundaki
          dosyalara Dosya Yöneticisi&apos;nden bakabilir, silmeden önce içeriğini
          doğrulayabilirsin. Riskli bir güncellemeden önce &quot;Klonla&quot; ile anlık bir
          kopya alabilirsin — zamanlanmış yedeği beklemeden.
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
