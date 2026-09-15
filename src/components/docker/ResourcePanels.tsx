"use client";

import { useCallback, useEffect, useState } from "react";
import { Info, Plus, Ruler, Trash2 } from "lucide-react";

import { Modal } from "@/components/Modal";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import { formatBytes } from "@/lib/metrics/catalog";
import type { UnusedReport } from "@/lib/docker/graph";
import type {
  DockerImage,
  DockerNetwork,
  DockerVolume,
  ResourceKind,
} from "@/lib/providers/types";
import { ImagePanel } from "./ImagePanel";
import { ImageDetail, VolumeDetail } from "./ResourceDetail";

export type ResourcesPayload = {
  images: DockerImage[];
  volumes: DockerVolume[];
  networks: DockerNetwork[];
  unused: UnusedReport;
};

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

/**
 * Image / volume / ağ listeleri (M1.8).
 *
 * Üç sekme de aynı veriyi tek istekten alıyor: kullanım bilgisi (hangi
 * container hangi kaynağı tutuyor) container listesinden çıkarıldığı için
 * ayrı ayrı çekmek aynı listeyi üç kez indirmek olurdu.
 *
 * Her satırda KİMİN kullandığı yazıyor. "Kullanılmıyor" damgası silme
 * düğmesinin tek gerekçesi olduğu için, o damganın neye dayandığı görünür
 * olmalı — kullanıcı kararı kendisi doğrulayabilsin.
 */
export function useResources(enabled: boolean) {
  const [data, setData] = useState<ResourcesPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  /*
    Yenileme jetonu (M3.38). Liste eskiden yalnızca sekmeye ilk girişte
    çekiliyordu; sunucuda bir image silindiğinde ya da bir ağ eklendiğinde
    kullanıcının sayfayı yeniden yüklemekten başka çaresi yoktu.
  */
  const [token, setToken] = useState(0);

  const refresh = useCallback(() => setToken((value) => value + 1), []);

  /*
    Yanıtı duruma yazan kısım effect'ten AYRI: setState'i effect gövdesinde
    doğrudan çağırmak zincirleme render üretiyor ve eslint kuralı buna izin
    vermiyor. Aynı desen dosya tarayıcıda ve compose üretme sekmesinde de var.
  */
  const apply = useCallback((payload: ResourcesPayload & { error?: string }, ok: boolean) => {
    if (ok) {
      setData(payload);
      setError(null);
    } else {
      setError(payload.error ?? "Kaynaklar alınamadı.");
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();

    (async () => {
      try {
        const response = await fetch("/api/docker/resources", {
          signal: controller.signal,
          cache: "no-store",
        });
        apply(await response.json(), response.ok);
      } catch (fetchError) {
        if ((fetchError as Error)?.name !== "AbortError") setError("Sunucuya ulaşılamadı.");
      }
    })();

    return () => controller.abort();
  }, [enabled, token, apply]);

  return { data, error, setData, refresh };
}

export function ResourcePanel({
  kind,
  data,
  canAct,
  onChanged,
  onOpenContainer,
  onOpenStack,
}: {
  kind: ResourceKind;
  data: ResourcesPayload;
  canAct: boolean;
  onChanged: (next: ResourcesPayload) => void;
  /**
   * Container adına tıklanınca detay popup'ını açar (M3.40).
   *
   * Tabloda "hangi container kullanıyor" yazıyordu ama yalnızca metin
   * olarak — kullanıcı adı okuyup Container sekmesine gidip aramak
   * zorundaydı. `NetworkGraph.onSelect` ile aynı geri-çağrı deseni.
   */
  onOpenContainer: (name: string) => void;
  /** Yığın adına tıklanınca Stack sekmesine geçip o yığını süzer. */
  onOpenStack: (project: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageDetail, setImageDetail] = useState<DockerImage | null>(null);
  const [volumeDetail, setVolumeDetail] = useState<DockerVolume | null>(null);

  /**
   * Volume boyutları isteğe bağlı (M3.24).
   *
   * `docker system df` her volume'ü diskte yürüyerek ölçüyor ve büyük
   * kurulumlarda saniyeler sürüyor. Bunu her liste açılışında yapmak, sekmeye
   * girmenin bedelini görünür şekilde artırırdı — kullanıcı isteyince.
   */
  const [sizes, setSizes] = useState<Record<string, number> | null>(null);
  const [sizesBusy, setSizesBusy] = useState(false);
  const [olustur, setOlustur] = useState(false);

  async function boyutlariHesapla() {
    setSizesBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/docker/resources?detail=sizes", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) setError(payload.error ?? "Boyutlar hesaplanamadı.");
      else setSizes(payload.volumeBytes as Record<string, number>);
    } catch {
      setError("Sunucuya ulaşılamadı.");
    } finally {
      setSizesBusy(false);
    }
  }

  async function remove(id: string, label: string, danger: boolean) {
    const message = danger
      ? `"${label}" SİLİNECEK ve içindeki veri geri getirilemez.\n\nDevam edilsin mi?`
      : `"${label}" silinsin mi?`;
    if (!confirm(message)) return;

    setBusy(id);
    setError(null);
    try {
      const response = await fetch("/api/docker/resources", {
        method: "POST",
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: JSON.stringify({ kind, id }),
      });
      const payload = await response.json();
      if (!response.ok) setError(payload.error ?? "Silinemedi.");
      else onChanged(payload as ResourcesPayload);
    } catch {
      setError("Sunucuya ulaşılamadı.");
    } finally {
      setBusy(null);
    }
  }

  const rows =
    kind === "volume"
      ? data.volumes.map((volume) => ({
          id: volume.name,
          label: volume.name,
          sub: volume.mountpoint,
          size: sizes?.[volume.name] === undefined ? "—" : formatBytes(sizes[volume.name]),
          usedBy: volume.usedBy,
          removable: volume.usedBy.length === 0,
          danger: true,
          note: null,
          createdAt: volume.createdAt,
          stack: volume.composeProject,
          detail: () => setVolumeDetail(volume),
        }))
      : data.networks.map((network) => ({
          id: network.id,
          label: network.name,
          sub: network.subnet ?? network.driver,
          size: "—",
          usedBy: network.attached,
          removable: !network.builtin && network.attached.length === 0,
          danger: false,
          note: network.builtin ? "Docker'ın kendi ağı — silinemez" : null,
          createdAt: null as number | null,
          stack: null as string | null,
          detail: null as null | (() => void),
        }));

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-md border border-danger/40 bg-surface px-4 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {kind === "image" && (
        <ImagePanel
          images={data.images}
          canAct={canAct}
          busyId={busy}
          onRemove={(id, label) => void remove(id, label, false)}
          onDetail={setImageDetail}
        />
      )}

      {kind === "volume" && (
        <div className="flex flex-wrap items-center gap-2">
          {canAct && (
            <button
              type="button"
              onClick={() => setOlustur(true)}
              className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs text-subtle transition-colors hover:border-brand hover:text-brand"
            >
              <Plus className="size-3.5" />
              Yeni volume
            </button>
          )}

          <button
            type="button"
            onClick={() => void boyutlariHesapla()}
            disabled={sizesBusy}
            className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs text-subtle transition-colors hover:text-brand disabled:opacity-50"
          >
            <Ruler className="size-3.5" />
            {sizesBusy ? "hesaplanıyor…" : "Boyutları hesapla"}
          </button>
          <span className="text-[11px] text-subtle">
            Docker her volume&apos;ü diskte yürüyerek ölçer; büyük volume&apos;larda
            saniyeler sürebilir.
          </span>
        </div>
      )}

      {kind !== "image" && (
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="rtable w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-subtle">
              <th className="px-4 py-2.5 font-medium">Ad</th>
              {kind === "volume" && <th className="px-4 py-2.5 font-medium">Boyut</th>}
              {kind === "volume" && <th className="px-4 py-2.5 font-medium">Oluşturulma</th>}
              {kind === "volume" && <th className="px-4 py-2.5 font-medium">Yığın</th>}
              <th className="px-4 py-2.5 font-medium">Kullanan</th>
              <th className="px-4 py-2.5 text-right font-medium">İşlem</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.id}>
                <td data-label="" className="px-4 py-3">
                  <div className="font-medium">{row.label}</div>
                  <div className="truncate font-mono text-[11px] text-subtle" title={row.sub}>
                    {row.sub}
                  </div>
                  {row.note && <div className="text-[10px] text-subtle">{row.note}</div>}
                </td>

                {kind === "volume" && (
                  <td data-label="Boyut" className="px-4 py-3 text-xs">{row.size}</td>
                )}

                {kind === "volume" && (
                  <td data-label="Oluşturulma" className="px-4 py-3 text-xs text-subtle">
                    {row.createdAt
                      ? new Date(row.createdAt * 1000).toLocaleDateString("tr-TR")
                      : "—"}
                  </td>
                )}

                {kind === "volume" && (
                  <td data-label="Yığın" className="px-4 py-3 text-xs">
                    {row.stack ? (
                      <button
                        type="button"
                        onClick={() => onOpenStack(row.stack!)}
                        title={`${row.stack} yığınını Stack sekmesinde göster`}
                        className="text-subtle underline decoration-dotted transition-colors hover:text-brand"
                      >
                        {row.stack}
                      </button>
                    ) : (
                      <span className="text-subtle">—</span>
                    )}
                  </td>
                )}

                <td data-label="Kullanan" className="px-4 py-3 text-xs">
                  {row.usedBy.length === 0 ? (
                    <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[10px] font-medium text-warn">
                      kullanılmıyor
                    </span>
                  ) : (
                    <span className="flex flex-wrap gap-x-1.5 gap-y-0.5">
                      {row.usedBy.map((name) => (
                        <button
                          key={name}
                          type="button"
                          onClick={() => onOpenContainer(name)}
                          title={`${name} detayını aç`}
                          className="underline decoration-dotted transition-colors hover:text-brand"
                        >
                          {name}
                        </button>
                      ))}
                    </span>
                  )}
                </td>

                <td data-label="" className="px-4 py-3 text-right max-md:text-left">
                  <div className="flex items-center justify-end gap-1 max-md:justify-start">
                    {row.detail && (
                      <button
                        type="button"
                        title="Detay"
                        aria-label={`${row.label} detayı`}
                        onClick={row.detail}
                        className="rounded border border-line p-1.5 text-subtle transition-colors hover:text-brand"
                      >
                        <Info className="size-3.5" />
                      </button>
                    )}

                    {/*
                      Silme düğmesi ARTIK HEP ÇİZİLİYOR (M3.44).

                      Eskiden `removable` false ise hiç görünmüyordu ve
                      kullanan container'ı olan bir volume'de düğme yoktu —
                      kullanıcı "silme özelliği eklenmemiş" sanıyordu. Oysa
                      özellik vardı, yalnızca koşul sağlanmıyordu.
                      Devre dışı çizip SEBEBİNİ yazmak, olmayan bir şey
                      aramaya bırakmaktan iyi.
                    */}
                    {canAct && (
                      <button
                        type="button"
                        title={
                          row.removable
                            ? "Sil"
                            : row.usedBy.length > 0
                              ? `Silinemez — kullanan: ${row.usedBy.join(", ")}. Önce o container'ları durdurup kaldırman gerekiyor.`
                              : "Silinemez"
                        }
                        aria-label={`${row.label} sil`}
                        disabled={busy === row.id || !row.removable}
                        onClick={() => void remove(row.id, row.label, row.danger)}
                        className="rounded border border-line p-1.5 text-subtle transition-colors hover:border-danger hover:text-danger disabled:opacity-40"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {kind !== "image" && rows.length === 0 && (
        <p className="rounded-lg border border-dashed border-line bg-surface px-5 py-8 text-center text-sm text-subtle">
          Kayıt yok.
        </p>
      )}

      {kind === "volume" && (
        <p className="text-[11px] text-warn">
          Volume silmek VERİ SİLER. &quot;Kullanılmıyor&quot; damgası durmuş
          container&apos;ları da hesaba katar — yani geçici olarak durdurulmuş bir
          servisin volume&apos;u burada güvenli görünmez, gerçekten sahipsizdir. Yine de
          silmeden önce yedeğin olduğundan emin ol.
        </p>
      )}

      {olustur && (
        <VolumeDialog
          onClose={() => setOlustur(false)}
          onCreated={(payload) => {
            onChanged(payload as ResourcesPayload);
            setOlustur(false);
          }}
        />
      )}

      {imageDetail && (
        <ImageDetail
          image={imageDetail}
          canAct={canAct}
          onChanged={(payload) => onChanged(payload as ResourcesPayload)}
          onClose={() => setImageDetail(null)}
        />
      )}

      {volumeDetail && (
        <VolumeDetail
          volume={volumeDetail}
          sizeBytes={sizes?.[volumeDetail.name] ?? null}
          canAct={canAct}
          onChanged={(payload) => onChanged(payload as ResourcesPayload)}
          onClose={() => setVolumeDetail(null)}
        />
      )}
    </div>
  );
}

/** Kullanılmayan kaynakların özeti — temizlik sekmesinin başında durur. */
export function UnusedSummary({ unused }: { unused: UnusedReport }) {
  const total = unused.images.length + unused.volumes.length + unused.networks.length;

  if (total === 0) {
    return (
      <div className="rounded-lg border border-line bg-surface px-5 py-4 text-sm text-ok">
        Kullanılmayan image, volume veya ağ yok — ortalık temiz.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="border-b border-line px-5 py-3">
        <h2 className="font-semibold">Kullanılmayan kaynaklar</h2>
        <p className="mt-0.5 text-xs text-subtle">
          Hiçbir container&apos;ın (durmuşlar dahil) referans vermediği kaynaklar.
          Image&apos;lar silinirse ~{formatBytes(unused.reclaimableBytes)} yer açılır.
        </p>
      </div>

      <dl className="divide-y divide-line text-sm">
        <UnusedRow
          label="Image"
          items={unused.images.map((image) => `${image.label} (${formatBytes(image.sizeBytes)})`)}
        />
        <UnusedRow label="Volume" items={unused.volumes.map((volume) => volume.name)} danger />
        <UnusedRow label="Ağ" items={unused.networks.map((network) => network.name)} />
      </dl>
    </div>
  );
}

function UnusedRow({
  label,
  items,
  danger,
}: {
  label: string;
  items: string[];
  danger?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-x-3 px-5 py-2.5">
      <dt className="w-20 shrink-0 text-xs text-subtle">
        {label} ({items.length})
      </dt>
      <dd className={`min-w-0 flex-1 text-xs ${danger && items.length > 0 ? "text-danger" : ""}`}>
        {items.length === 0 ? <span className="text-subtle">—</span> : items.join(" · ")}
      </dd>
    </div>
  );
}

/**
 * Yeni volume diyaloğu (M3.44).
 *
 * Panelden bir yığın kurulabiliyordu ama ona volume verilemiyordu; tek yol
 * compose dosyasına yazıp `up` çalıştırmaktı.
 *
 * Sürücü seçenekleri açıkta çünkü `local` sürücünün asıl gücü orada: NFS ya da
 * CIFS üzerinde bir volume tanımlamak tam olarak bu üç anahtarla yapılıyor
 * (`type`, `o`, `device`) ve panelin bunu sunmaması, kullanıcıyı sunucuda
 * `docker volume create` yazmaya geri gönderirdi.
 */
function VolumeDialog({
  onCreated,
  onClose,
}: {
  onCreated: (payload: unknown) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("uygulama-verisi");
  const [driver, setDriver] = useState("local");
  const [options, setOptions] = useState("");
  const [labels, setLabels] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gecerli = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,63}$/.test(name.trim());

  /** `anahtar=değer` satırlarını nesneye çevirir; boş satırlar atlanır. */
  function ayristir(text: string): Record<string, string> {
    return Object.fromEntries(
      text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const index = line.indexOf("=");
          return index === -1
            ? [line, ""]
            : [line.slice(0, index).trim(), line.slice(index + 1).trim()];
        }),
    );
  }

  async function gonder() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/docker/resources", {
        method: "POST",
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: JSON.stringify({
          action: "volume-create",
          spec: {
            name: name.trim(),
            driver,
            options: ayristir(options),
            labels: ayristir(labels),
          },
        }),
      });
      const payload = await response.json();
      if (response.ok) onCreated(payload);
      else setError(payload.error ?? "Volume oluşturulamadı.");
    } catch {
      setError("Sunucuya ulaşılamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title="Yeni volume" onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="text-subtle">Volume adı</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-canvas px-3 py-1.5 font-mono text-sm outline-none focus:border-brand"
          />
        </label>

        <label className="block text-sm">
          <span className="text-subtle">Sürücü</span>
          <input
            value={driver}
            onChange={(event) => setDriver(event.target.value)}
            placeholder="local"
            className="mt-1 w-full rounded-md border border-line bg-canvas px-3 py-1.5 font-mono text-sm outline-none focus:border-brand"
          />
        </label>

        <label className="block text-sm">
          <span className="text-subtle">
            Sürücü seçenekleri — satır başına `anahtar=değer`
          </span>
          <textarea
            value={options}
            onChange={(event) => setOptions(event.target.value)}
            rows={3}
            spellCheck={false}
            placeholder={"type=nfs\no=addr=192.168.1.10,rw\ndevice=:/yol/paylasim"}
            className="mt-1 w-full rounded-md border border-line bg-canvas px-3 py-1.5 font-mono text-xs outline-none focus:border-brand"
          />
          <span className="mt-1 block text-[11px] text-subtle">
            Boş bırakılırsa volume Docker&apos;ın kendi dizininde
            (<span className="font-mono">/var/lib/docker/volumes</span>) oluşur — çoğu
            durumda istenen budur.
          </span>
        </label>

        <label className="block text-sm">
          <span className="text-subtle">Etiketler — satır başına `anahtar=değer`</span>
          <textarea
            value={labels}
            onChange={(event) => setLabels(event.target.value)}
            rows={2}
            spellCheck={false}
            className="mt-1 w-full rounded-md border border-line bg-canvas px-3 py-1.5 font-mono text-xs outline-none focus:border-brand"
          />
        </label>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand"
          >
            Vazgeç
          </button>
          <button
            type="button"
            disabled={!gecerli || busy}
            title={gecerli ? undefined : "Ad harf ya da rakamla başlamalı (2-64 karakter)."}
            onClick={() => void gonder()}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Oluşturuluyor…" : "Oluştur"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
