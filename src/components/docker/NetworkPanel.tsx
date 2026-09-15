"use client";

import { useState } from "react";
import { Copy, Info, Link2, Plus, Trash2, Unlink } from "lucide-react";

import { Modal } from "@/components/Modal";
import { readCsrfToken } from "./detail/shared";
import { CSRF_HEADER } from "@/lib/auth/types";
import type { DockerNetwork } from "@/lib/providers/types";
import type { ContainerView } from "@/lib/docker/types";

/**
 * Ağ sekmesi (M3.41).
 *
 * Öncesinde ağlar `ResourcePanel`'in genel üç sütunlu tablosunu paylaşıyordu:
 * ad, kullanan, sil. Ağın kendi bilgisi (sürücü, kapsam, subnet, gateway) ya
 * tek bir alt satıra sıkışıyor ya hiç görünmüyordu ve **ağ oluşturmanın yolu
 * yoktu** — panelden bir yığın kurabiliyor ama ona bir ağ veremiyordunuz.
 *
 * ## "hostname" alanı bilerek yok
 *
 * dockhand'in ağ oluşturma diyaloğunda bir "hostname" alanı var; Docker'ın ağ
 * API'sinde karşılığı YOK — hostname container'a ait bir ayar, ağa değil.
 * Olmayan bir ayarı varmış gibi göstermek, kullanıcının onu doldurup hiçbir
 * şey olmadığını görmesi demek olurdu.
 */

type Props = {
  networks: DockerNetwork[];
  containers: ContainerView[];
  query: string;
  canAct: boolean;
  onChanged: (payload: unknown) => void;
  onOpenContainer: (name: string) => void;
};

/**
 * Sunulan ağ sürücüleri.
 *
 * ⚠️ `macvlan` ve `ipvlan` BİLEREK YOK. İkisi de `-o parent=<arayüz>` olmadan
 * anlamsız ve Docker bunu HATA OLARAK SÖYLEMİYOR: parent verilmeden yaratılan
 * bir macvlan ağı sorunsuz oluşuyor, panel "başarılı" diyor, sonra o ağa
 * bağlanan container dış dünyaya çıkamıyor. Sunucuda ölçüldü:
 *
 *     docker network create -d macvlan panel-test-macvlan   → başarılı
 *     docker run --network panel-test-macvlan alpine ping 1.1.1.1
 *     → ping: sendto: Network unreachable
 *
 * Desteklemediğimiz bir seçeneği listede tutmak, kullanıcıya sessizce bozuk
 * bir ağ kurdurmak demek. Parent arayüz seçimi eklendiğinde geri gelirler.
 *
 * `overlay` duruyor: Swarm olmayan bir host'ta Docker açık bir hata veriyor
 * ("this node is not a swarm manager"), yani kullanıcı ne olduğunu anlıyor.
 */
const DRIVERS = ["bridge", "overlay"];

async function post(body: Record<string, unknown>) {
  const response = await fetch("/api/docker/resources", {
    method: "POST",
    headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
    body: JSON.stringify(body),
  });
  return { ok: response.ok, payload: await response.json() };
}

export function NetworkPanel({
  networks,
  containers,
  query,
  canAct,
  onChanged,
  onOpenContainer,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [sonuc, setSonuc] = useState<{ ok: boolean; text: string } | null>(null);
  const [detay, setDetay] = useState<DockerNetwork | null>(null);
  const [olustur, setOlustur] = useState<{ base: DockerNetwork | null } | null>(null);
  const [baglanacak, setBaglanacak] = useState<DockerNetwork | null>(null);

  const q = query.trim().toLocaleLowerCase("tr");
  const rows = q
    ? networks.filter(
        (network) =>
          network.name.toLocaleLowerCase("tr").includes(q) ||
          network.driver.toLocaleLowerCase("tr").includes(q),
      )
    : networks;

  async function calistir(key: string, body: Record<string, unknown>, basarili: string) {
    setBusy(key);
    setSonuc(null);
    try {
      const { ok, payload } = await post(body);
      if (ok) {
        setSonuc({ ok: true, text: basarili });
        onChanged(payload);
      } else {
        setSonuc({ ok: false, text: payload.error ?? "İşlem başarısız." });
      }
      return ok;
    } catch {
      setSonuc({ ok: false, text: "Sunucuya ulaşılamadı." });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function sil(network: DockerNetwork) {
    if (!confirm(`"${network.name}" ağı silinsin mi?`)) return;
    await calistir(
      network.id,
      { kind: "network", id: network.id },
      `${network.name} silindi.`,
    );
  }

  async function bagla(network: DockerNetwork, container: string) {
    return calistir(
      network.id,
      { action: "network-connect", id: network.id, container },
      `${container} → ${network.name} bağlandı.`,
    );
  }

  /**
   * Container'ı ağdan çıkarır.
   *
   * Hangi container olduğu ÇAĞIRANDAN geliyor — kullanıcı zaten o container'ın
   * adının yanındaki düğmeye basmış durumda ve ona bir de "hangisi?" diye
   * sormak gereksiz bir adım. Geriye yalnızca onay kalıyor.
   */
  async function ayir(network: DockerNetwork, container: string) {
    if (!confirm(`"${container}" ${network.name} ağından çıkarılsın mı?`)) return;

    await calistir(
      network.id,
      { action: "network-disconnect", id: network.id, container },
      `${container} ağdan çıkarıldı.`,
    );
  }

  return (
    <div className="space-y-3">
      {canAct && (
        <button
          type="button"
          onClick={() => setOlustur({ base: null })}
          className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-xs text-subtle transition-colors hover:border-brand hover:text-brand"
        >
          <Plus className="size-3.5" aria-hidden />
          Yeni ağ
        </button>
      )}

      {sonuc && (
        <p className={`text-sm ${sonuc.ok ? "text-ok" : "text-danger"}`}>{sonuc.text}</p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-surface px-5 py-8 text-center text-sm text-subtle">
          {networks.length === 0 ? "Ağ yok." : "Eşleşen ağ yok."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="rtable w-full min-w-[48rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-subtle">
                <th className="px-4 py-2.5 font-medium">Ad</th>
                <th className="px-4 py-2.5 font-medium">Sürücü</th>
                <th className="px-4 py-2.5 font-medium">Kapsam</th>
                <th className="px-4 py-2.5 font-medium">Subnet</th>
                <th className="px-4 py-2.5 font-medium">Gateway</th>
                <th className="px-4 py-2.5 font-medium">Container</th>
                <th className="px-4 py-2.5 text-right font-medium">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((network) => (
                <tr key={network.id}>
                  <td data-label="" className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setDetay(network)}
                      className="text-left font-medium transition-colors hover:text-brand"
                    >
                      {network.name}
                    </button>
                    <div className="flex flex-wrap gap-1.5 text-[10px] text-subtle">
                      {network.builtin && <span>Docker&apos;ın kendi ağı — silinemez</span>}
                      {network.internal && <span>internal</span>}
                      {network.attachable && <span>attachable</span>}
                      {network.composeProject && <span>compose: {network.composeProject}</span>}
                    </div>
                  </td>

                  <td data-label="Sürücü" className="px-4 py-3 text-xs">{network.driver}</td>
                  <td data-label="Kapsam" className="px-4 py-3 text-xs text-subtle">
                    {network.scope}
                  </td>
                  <td data-label="Subnet" className="px-4 py-3 font-mono text-[11px]">
                    {network.subnet ?? <span className="text-subtle">—</span>}
                  </td>
                  <td data-label="Gateway" className="px-4 py-3 font-mono text-[11px]">
                    {network.gateway ?? <span className="text-subtle">—</span>}
                  </td>

                  <td data-label="Container" className="px-4 py-3 text-xs">
                    {network.attached.length === 0 ? (
                      <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[10px] font-medium text-warn">
                        kullanılmıyor
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDetay(network)}
                        title={network.attached.join(", ")}
                        className="underline decoration-dotted transition-colors hover:text-brand"
                      >
                        {network.attached.length}
                      </button>
                    )}
                  </td>

                  <td data-label="" className="px-4 py-3 text-right max-md:text-left">
                    <div className="flex flex-wrap items-center justify-end gap-1 max-md:justify-start">
                      <Islem title="Detay" onClick={() => setDetay(network)}>
                        <Info className="size-3.5" />
                      </Islem>

                      <Islem
                        title="Ağ kimliğini kopyala"
                        onClick={() => {
                          void navigator.clipboard?.writeText(network.id);
                          setSonuc({ ok: true, text: `${network.name} kimliği kopyalandı.` });
                        }}
                      >
                        <Copy className="size-3.5" />
                      </Islem>

                      {canAct && (
                        <>
                          <Islem
                            title="Container bağla"
                            disabled={busy === network.id || network.builtin}
                            onClick={() => setBaglanacak(network)}
                          >
                            <Link2 className="size-3.5" />
                          </Islem>

                          {/*
                            Ağdan çıkarma DETAYDA: orada her container'ın kendi
                            satırı ve kendi düğmesi var, yani "hangisi?" diye
                            sormaya gerek kalmıyor. Buradaki düğme oraya
                            götürüyor.
                          */}
                          {network.attached.length > 0 && (
                            <Islem
                              title="Bağlı container'lar — çıkarmak için detayı aç"
                              onClick={() => setDetay(network)}
                            >
                              <Unlink className="size-3.5" />
                            </Islem>
                          )}

                          <Islem
                            title="Ağı çoğalt — aynı ayarlarla yeni bir ağ"
                            onClick={() => setOlustur({ base: network })}
                          >
                            <Copy className="size-3.5 rotate-180" />
                          </Islem>

                          {/*
                            Silme düğmesi ARTIK HEP ÇİZİLİYOR. Eskiden koşul
                            sağlanmadığında hiç görünmüyordu ve kullanıcı "silme
                            eklenmemiş" sanıyordu — oysa özellik vardı, yalnızca
                            koşul tutmuyordu. Devre dışı çizip SEBEBİNİ yazmak,
                            olmayan bir şey aramaya bırakmaktan iyi.
                          */}
                          <Islem
                            title={
                              network.builtin
                                ? "Docker'ın kendi ağı — silinemez"
                                : network.attached.length > 0
                                  ? `Silinemez — bağlı: ${network.attached.join(", ")}. Önce onları çıkarman gerekiyor.`
                                  : "Ağı sil"
                            }
                            danger
                            disabled={
                              busy === network.id || network.builtin || network.attached.length > 0
                            }
                            onClick={() => void sil(network)}
                          >
                            <Trash2 className="size-3.5" />
                          </Islem>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-subtle">
        Yalnızca hiçbir container&apos;ın bağlı olmadığı ağlar silinebilir; Docker&apos;ın
        kendi ağları (<span className="font-mono">bridge</span>,{" "}
        <span className="font-mono">host</span>, <span className="font-mono">none</span>) hiç
        silinemez. Bir yığının ağını silmek, yığın yeniden kurulunca Docker tarafından
        yeniden yaratılır.
      </p>

      {detay && (
        <NetworkDetail
          network={detay}
          canAct={canAct}
          onOpenContainer={onOpenContainer}
          onDisconnect={(container) => void ayir(detay, container)}
          onClose={() => setDetay(null)}
        />
      )}

      {baglanacak && (
        <ConnectDialog
          network={baglanacak}
          containers={containers}
          onClose={() => setBaglanacak(null)}
          onSubmit={async (container) => {
            const ok = await bagla(baglanacak, container);
            if (ok) setBaglanacak(null);
          }}
        />
      )}

      {olustur && (
        <NetworkDialog
          base={olustur.base}
          onClose={() => setOlustur(null)}
          onSubmit={async (spec) => {
            const ok = await calistir(
              "create",
              { action: "network-create", spec },
              `${spec.name} ağı oluşturuldu.`,
            );
            if (ok) setOlustur(null);
          }}
        />
      )}
    </div>
  );
}

function Islem({
  title,
  onClick,
  disabled,
  danger,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={`rounded border border-line p-1.5 text-subtle transition-colors disabled:opacity-40 ${
        danger ? "hover:border-danger hover:text-danger" : "hover:text-brand"
      }`}
    >
      {children}
    </button>
  );
}

function NetworkDetail({
  network,
  canAct,
  onOpenContainer,
  onDisconnect,
  onClose,
}: {
  network: DockerNetwork;
  canAct: boolean;
  onOpenContainer: (name: string) => void;
  onDisconnect: (container: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal open title={network.name} onClose={onClose} wide>
      <div className="space-y-4">
        <dl className="space-y-1.5 text-sm">
          <Satir label="ID">
            <span className="break-all font-mono text-[11px]">{network.id}</span>
          </Satir>
          <Satir label="Sürücü">{network.driver}</Satir>
          <Satir label="Kapsam">{network.scope}</Satir>
          <Satir label="Subnet">
            <span className="font-mono text-[11px]">{network.subnet ?? "—"}</span>
          </Satir>
          <Satir label="Gateway">
            <span className="font-mono text-[11px]">{network.gateway ?? "—"}</span>
          </Satir>
          <Satir label="Internal">
            {network.internal ? "evet — dış dünyaya çıkışı yok" : "hayır"}
          </Satir>
          <Satir label="Attachable">{network.attachable ? "evet" : "hayır"}</Satir>
          <Satir label="Compose">{network.composeProject ?? "—"}</Satir>
        </dl>

        <section className="rounded-lg border border-line px-3 py-2.5">
          <h3 className="mb-1.5 text-sm font-semibold">
            Bağlı container&apos;lar
            <span className="ml-1.5 text-xs font-normal text-subtle">
              {network.attached.length}
            </span>
          </h3>

          {network.attached.length === 0 ? (
            <p className="text-sm text-subtle">Hiçbir container bağlı değil.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {network.attached.map((name) => (
                <li key={name} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onOpenContainer(name);
                      onClose();
                    }}
                    className="min-w-0 flex-1 truncate text-left underline decoration-dotted transition-colors hover:text-brand"
                  >
                    {name}
                  </button>

                  {canAct && !network.builtin && (
                    <button
                      type="button"
                      onClick={() => onDisconnect(name)}
                      title={`${name} container'ını bu ağdan çıkar`}
                      className="inline-flex shrink-0 items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[11px] text-subtle transition-colors hover:border-danger hover:text-danger"
                    >
                      <Unlink className="size-3" aria-hidden />
                      Çıkar
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {Object.keys(network.labels).length > 0 && (
          <section className="rounded-lg border border-line px-3 py-2.5">
            <h3 className="mb-1.5 text-sm font-semibold">Etiketler</h3>
            <ul className="space-y-0.5 break-all font-mono text-[11px]">
              {Object.entries(network.labels).map(([key, value]) => (
                <li key={key}>
                  <span className="text-subtle">{key}=</span>
                  {value}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Modal>
  );
}

export type NetworkFormSpec = {
  name: string;
  driver: string;
  internal: boolean;
  attachable: boolean;
  labels: Record<string, string>;
  subnet: string;
  gateway: string;
  ipRange: string;
};

function NetworkDialog({
  base,
  onSubmit,
  onClose,
}: {
  /** Çoğaltmada kaynak ağ; sıfırdan oluşturmada null. */
  base: DockerNetwork | null;
  onSubmit: (spec: NetworkFormSpec) => void | Promise<void>;
  onClose: () => void;
}) {
  /*
    Alanlar VARSAYILANLARLA doluyor (M3.44). Boş bir form kullanıcıya "buraya ne
    yazmalıyım" sorusunu soruyor; dolu bir form ise hem çalışan bir örnek
    veriyor hem de biçimi gösteriyor. İstenirse hepsi değiştirilebilir.
  */
  const [name, setName] = useState(base ? `${base.name}-kopya` : "uygulama-agi");
  const [driver, setDriver] = useState(base?.driver ?? "bridge");
  const [internal, setInternal] = useState(base?.internal ?? false);
  const [attachable, setAttachable] = useState(base?.attachable ?? false);
  /*
    Çoğaltmada subnet BİLEREK boş geliyor: aynı subnet'e sahip iki ağ
    yaratılamaz ve kopyalamak kullanıcıyı kesin bir hataya sürüklerdi.
  */
  /*
    Çoğaltmada subnet kaynağınkinden KOPYALANMIYOR: aynı subnet'e sahip iki ağ
    yaratılamaz ve kopyalamak kullanıcıyı kesin bir hataya sürüklerdi. Onun
    yerine boş kalıyor — Docker kendi havuzundan seçiyor.

    Sıfırdan oluşturmada da boş: Docker'ın seçmesi neredeyse her zaman doğru
    olan ve dolu bir subnet, kullanıcıyı çakışma riskine sokar. Yer tutucu
    metin biçimi zaten gösteriyor.
  */
  const [subnet, setSubnet] = useState("");
  const [gateway, setGateway] = useState("");
  const [ipRange, setIpRange] = useState("");
  const [labels, setLabels] = useState(
    base
      ? Object.entries(base.labels)
          .filter(([key]) => !key.startsWith("com.docker.compose."))
          .map(([key, value]) => `${key}=${value}`)
          .join("\n")
      : "",
  );

  const gecerliAd = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/.test(name.trim());

  return (
    <Modal open title={base ? `${base.name} ağını çoğalt` : "Yeni ağ"} onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="text-subtle">Ağ adı</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="uygulama-agi"
            className="mt-1 w-full rounded-md border border-line bg-canvas px-3 py-1.5 font-mono text-sm outline-none focus:border-brand"
          />
        </label>

        <label className="block text-sm">
          <span className="text-subtle">Sürücü</span>
          <select
            value={driver}
            onChange={(event) => setDriver(event.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-canvas px-3 py-1.5 text-sm outline-none focus:border-brand"
          >
            {DRIVERS.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={internal}
              onChange={(event) => setInternal(event.target.checked)}
              className="size-3.5 accent-[var(--brand)]"
            />
            Internal
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={attachable}
              onChange={(event) => setAttachable(event.target.checked)}
              className="size-3.5 accent-[var(--brand)]"
            />
            Attachable
          </label>
        </div>

        <p className="text-[11px] text-subtle">
          <strong>Internal:</strong> ağdaki container&apos;lar birbirini görür ama dış
          dünyaya çıkamaz — veritabanı ağları için doğru seçim.{" "}
          <strong>Attachable:</strong> compose dışından{" "}
          <span className="font-mono">docker network connect</span> ile bağlanılabilir.
        </p>

        <fieldset className="space-y-2 rounded-lg border border-line px-3 py-2.5">
          <legend className="px-1 text-xs text-subtle">IPAM — hepsi isteğe bağlı</legend>
          {(
            [
              ["Subnet", subnet, setSubnet, "172.30.0.0/16"],
              ["Gateway", gateway, setGateway, "172.30.0.1"],
              ["IP aralığı", ipRange, setIpRange, "172.30.5.0/24"],
            ] as const
          ).map(([label, value, setter, placeholder]) => (
            <label key={label} className="block text-sm">
              <span className="text-subtle">{label}</span>
              <input
                value={value}
                onChange={(event) => setter(event.target.value)}
                placeholder={placeholder}
                className="mt-1 w-full rounded-md border border-line bg-canvas px-3 py-1.5 font-mono text-xs outline-none focus:border-brand"
              />
            </label>
          ))}
          <p className="text-[11px] text-subtle">
            Boş bırakılanlar Docker&apos;a hiç gönderilmez ve adresleme Docker&apos;ın
            kendi havuzundan yapılır.
          </p>
        </fieldset>

        <label className="block text-sm">
          <span className="text-subtle">Etiketler — satır başına `anahtar=değer`</span>
          <textarea
            value={labels}
            onChange={(event) => setLabels(event.target.value)}
            rows={3}
            spellCheck={false}
            className="mt-1 w-full rounded-md border border-line bg-canvas px-3 py-1.5 font-mono text-xs outline-none focus:border-brand"
          />
        </label>

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
            disabled={!gecerliAd}
            title={gecerliAd ? undefined : "Ad harf ya da rakamla başlamalı."}
            onClick={() =>
              void onSubmit({
                name: name.trim(),
                driver,
                internal,
                attachable,
                labels: Object.fromEntries(
                  labels
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .map((line) => {
                      const index = line.indexOf("=");
                      return index === -1
                        ? [line, ""]
                        : [line.slice(0, index).trim(), line.slice(index + 1).trim()];
                    }),
                ),
                subnet: subnet.trim(),
                gateway: gateway.trim(),
                ipRange: ipRange.trim(),
              })
            }
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Oluştur
          </button>
        </div>
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

/**
 * Container bağlama diyaloğu (M3.44).
 *
 * Öncesinde bu bir `prompt()`'tu ve kullanıcıdan container ADINI ELLE
 * YAZMASINI istiyordu — adı hatırlamak, doğru yazmak ve zaten bağlı olup
 * olmadığını bilmek kullanıcıya kalıyordu. Liste zaten elimizde; sormanın
 * anlamı yoktu.
 *
 * Zaten bağlı olanlar listede YOK: Docker bağlı bir container'ı yeniden
 * bağlamayı reddediyor, seçenekte göstermek kesin bir hataya davet olurdu.
 */
function ConnectDialog({
  network,
  containers,
  onSubmit,
  onClose,
}: {
  network: DockerNetwork;
  containers: ContainerView[];
  onSubmit: (container: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const adaylar = containers.filter(
    (container) => !network.attached.includes(container.name),
  );
  const [secim, setSecim] = useState(adaylar[0]?.name ?? "");

  return (
    <Modal open title={`${network.name} ağına container bağla`} onClose={onClose}>
      <div className="space-y-3">
        {adaylar.length === 0 ? (
          <p className="text-sm text-subtle">
            Bağlanabilecek container yok — çalışan ve durmuş tüm container&apos;lar zaten
            bu ağda.
          </p>
        ) : (
          <>
            <label className="block text-sm">
              <span className="text-subtle">Container</span>
              <select
                value={secim}
                onChange={(event) => setSecim(event.target.value)}
                className="mt-1 w-full rounded-md border border-line bg-canvas px-3 py-1.5 text-sm outline-none focus:border-brand"
              >
                {adaylar.map((container) => (
                  <option key={container.id} value={container.name}>
                    {container.name}
                    {container.state === "running" ? "" : ` (${container.state})`}
                  </option>
                ))}
              </select>
            </label>

            <p className="text-[11px] text-subtle">
              Bağlama anında geçerli olur; container&apos;ı yeniden başlatmak gerekmez.
              Ama compose ile yönetilen bir container&apos;da bir sonraki{" "}
              <span className="font-mono">compose up</span> bunu geri alır — kalıcı olması
              için ağı compose dosyasına da yazman gerekiyor.
            </p>
          </>
        )}

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
            disabled={!secim}
            onClick={() => void onSubmit(secim)}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Bağla
          </button>
        </div>
      </div>
    </Modal>
  );
}
