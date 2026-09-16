"use client";

import {
  ExternalLink,
  Info,
  Pause,
  Play,
  RotateCw,
  ScrollText,
  Square,
  Terminal as TerminalIcon,
  Trash2,
} from "lucide-react";

import { containerLink, portLink } from "@/lib/docker/labels";
import { formatBytes } from "@/lib/metrics/catalog";
import { useFormat, useT } from "@/lib/i18n/client";
import type { MessageKey, TFunction } from "@/lib/i18n/translate";
import type { ContainerView } from "@/lib/docker/types";
import type { ContainerAction } from "@/lib/providers/types";
import type { DrawerTab } from "./ContainerDrawer";

/**
 * Container tablosunun tek satırı (M3.37).
 *
 * DockerScreen'den ÇIKARILDI çünkü Stack sekmesi aynı satırı gösteriyor:
 * bir yığın açıldığında üyeleri, Container sekmesindeki satırın birebir aynısı
 * olarak listeleniyor. İki yerde iki farklı container görünümü öğretmenin
 * anlamı yok — kullanıcı aynı şeyi aynı yerde arayabilmeli.
 *
 * Kopyalanmak yerine çıkarılmasının sebebi de bu: kopya iki satır, zamanla
 * ayrışan iki satır demek. Bugün başlık/hücre çiftinde tam olarak bu oldu
 * (M3.36 — Image başlığı bir yerde vardı, diğerinde yoktu).
 */

export const STATE_STYLE: Record<string, string> = {
  running: "bg-ok/15 text-ok",
  exited: "bg-line text-subtle",
  restarting: "bg-warn/15 text-warn",
  paused: "bg-warn/15 text-warn",
  created: "bg-line text-subtle",
  dead: "bg-danger/15 text-danger",
};

const HEALTH_STYLE: Record<string, string> = {
  healthy: "text-ok",
  unhealthy: "text-danger",
  starting: "text-warn",
};

/** Eylem adlarının dil dosyasındaki anahtarları. */
export const ACTION_KEY: Record<ContainerAction, MessageKey> = {
  start: "docker.action.start",
  stop: "docker.action.stop",
  restart: "docker.action.restart",
  pause: "docker.action.pause",
  unpause: "docker.action.unpause",
};

/**
 * Port rozetleri — yayınlanmış olanlar tıklanabilir bağlantı (M3.27).
 *
 * Adres sırası: `panel.port.<port>.url` etiketi → `docker.public_host` ayarı →
 * tarayıcının adresi. Etiket en önde, çünkü reverse proxy arkasındaki gerçek
 * adresi yalnızca kullanıcı bilir; ayar ondan sonra gelir çünkü panele
 * Tailscale üzerinden bağlanan biri için tarayıcının adresi yanlış olabilir.
 *
 * UDP portları bağlantı OLMUYOR: bir tarayıcı UDP konuşamaz, tıklanabilir
 * göstermek çalışmayan bir bağlantı vermek olurdu.
 */
/** Bir portun okunabilir etiketi: "8080→80/tcp" ya da "80/tcp". */
function portLabel(port: ContainerView["ports"][number]): string {
  return port.hostPort === null
    ? `${port.containerPort}/${port.protocol}`
    : `${port.hostPort}→${port.containerPort}/${port.protocol}`;
}

/**
 * Tabloda gösterilecek azami rozet sayısı.
 *
 * Bir sınır olmak ZORUNDA: rozetler sarmıyor (satır yüksekliği sabit) ve
 * sınırsız bırakılırsa 12 portlu bir container tabloyu yatayda metrelerce
 * uzatırdı. Kalanlar "+N" olarak, tamamı ipucunda.
 */
const MAX_PORT_ROZETI = 3;

function PortCell({ container, publicHost }: { container: ContainerView; publicHost: string }) {
  const t = useT();
  if (container.ports.length === 0) return <span className="text-subtle">—</span>;

  const gosterilen = container.ports.slice(0, MAX_PORT_ROZETI);
  const gizli = container.ports.length - gosterilen.length;

  return (
    <span className="flex items-center gap-1 max-md:flex-wrap">
      {gosterilen.map((port, index) => {
        const etiket = portLabel(port);

        const key = `${port.hostPort}-${port.containerPort}-${port.protocol}-${index}`;

        if (port.hostPort === null || port.protocol !== "tcp") {
          return (
            <span key={key} className="text-subtle">
              {etiket}
            </span>
          );
        }

        const özel = portLink(container.labels, port.hostPort, etiket);
        const host = publicHost || (typeof window === "undefined" ? "" : window.location.hostname);
        const href = özel?.url ?? (host ? `http://${host}:${port.hostPort}` : null);

        if (!href) {
          return (
            <span key={key} className="text-subtle">
              {etiket}
            </span>
          );
        }

        return (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            title={t("docker.row.openInNewTab", { href })}
            className="inline-flex items-center gap-0.5 rounded border border-line px-1 transition-colors hover:border-brand hover:text-brand"
          >
            {özel ? özel.label : etiket}
            <ExternalLink className="size-2.5 opacity-60" aria-hidden />
          </a>
        );
      })}

      {gizli > 0 && (
        <span
          className="shrink-0 text-subtle"
          title={container.ports.map(portLabel).join(" · ")}
        >
          +{gizli}
        </span>
      )}
    </span>
  );
}

export type RowHandlers = {
  open: (container: ContainerView, tab: DrawerTab) => void;
  runAction: (container: ContainerView, action: ContainerAction) => void;
  removeContainer: (container: ContainerView) => void;
  toggleSelect: (id: string) => void;
};

export function ContainerRow({
  container,
  visible,
  publicHost,
  canAct,
  canExec,
  busyId,
  selected,
  showSelect,
  indent,
  handlers,
}: {
  container: ContainerView;
  /** Görünür sütun kimlikleri — sütun seçicisinden geliyor. */
  visible: ReadonlySet<string>;
  publicHost: string;
  canAct: boolean;
  canExec: boolean;
  busyId: string | null;
  selected: boolean;
  showSelect: boolean;
  /** Yığın üyesi olarak çizilirken ada girinti verir. */
  indent?: boolean;
  handlers: RowHandlers;
}) {
  const t = useT();
  const f = useFormat();
  const { open, runAction, removeContainer, toggleSelect } = handlers;

  return (
    /*
      Satır yüksekliği SABİT (M3.46 düzeltmesi).

      Tüm sütunlar açıkken tablo kapsayıcısına sığmıyor ve tarayıcı, kaydırma
      çubuğu çıkarmak yerine hücreleri sarıyordu: İşlemler sütunu iyice
      daralınca altı düğme ALT ALTA diziliyor ve satır 200 pikseli buluyordu.
      Bir satırın yüksekliğinin, o satırdaki port sayısına ya da o an açık
      sütunlara göre değişmesi tabloyu okunmaz yapıyor.

      Çözüm iki parçalı: her hücre `md` üstünde TEK SATIR (`whitespace-nowrap`
      + gerekince kesme), böylece hiçbir hücre sarmıyor ve tablo gerçek
      genişliğine ulaşıp `overflow-x-auto` devreye giriyor; `h-14` ise geriye
      kalan farkları da kapatıp bütün satırları eşitliyor.

      Dar ekranda (`rtable` kart düzeni) kural YOK: orada her hücre kendi
      satırında ve sarma doğru davranış.
    */
    <tr className="md:h-14">
      {showSelect && (
        <td data-label="" className="px-3 py-3">
          {container.locked ? (
            /*
              Emniyet kilidi (M3.27/M3.30): panelin kendisi ve
              reverse proxy toplu seçime giremiyor. Kutuyu hiç
              çizmemek yerine devre dışı çizmek, "unutuldu" değil
              "bilerek kapalı" olduğunu anlatıyor.
            */
            <input
              type="checkbox"
              disabled
              checked={false}
              readOnly
              aria-label={t("docker.row.lockedAria", { name: container.name })}
              title={t("docker.row.lockedTitle")}
              className="size-3.5 accent-[var(--brand)] opacity-40"
            />
          ) : (
            <input
              type="checkbox"
              checked={selected}
              onChange={() => toggleSelect(container.id)}
              aria-label={t("docker.row.select", { name: container.name })}
              className="size-3.5 accent-[var(--brand)]"
            />
          )}
        </td>
      )}
      <td data-label="" className="px-4 py-3">
        {/*
          Ad hücresi md üstünde SINIRLI genişlikte (M3.46).

          Sınır olmadan uzun bir container adı ("home-assistant-google-drive-
          backup" gibi) hücreyi kelime kelime alt satıra sarıyor ve TÜM satır
          dikeyde iki-üç kat büyüyordu: tablonun geri kalanı tek satırlık
          olduğu için o satırın yanında koca bir boşluk kalıyordu.

          Sınır yalnızca `md` ÜSTÜNDE: dar ekranda tablo karta dönüşüyor
          (`rtable`) ve orada sarma doğru davranış — kesilen bir ada karta
          sığdığı hâlde ulaşamamak olurdu. Tam ad her koşulda `title`'da.
        */}
        <div className="md:max-w-[18rem]">
          <div className="flex min-w-0 items-baseline gap-1.5">
            {/*
              Ad tıklanabilir: detay penceresine giden yol eskiden
              yalnızca küçük bir simgeydi ve keşfedilmiyordu.
            */}
            <button
              type="button"
              onClick={() => open(container, "genel")}
              title={container.name}
              className={`min-w-0 text-left font-medium transition-colors hover:text-brand md:truncate ${
                indent ? "pl-4" : ""
              }`}
            >
              {container.name}
            </button>
            {/*
              `panel.url` etiketi: reverse proxy arkasındaki gerçek
              adres yalnızca kullanıcı tarafından bilinebiliyor.
            */}
            {(() => {
              const link = containerLink(container.labels, container.name);
              return link ? (
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  title={link.url}
                  className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-subtle transition-colors hover:text-brand"
                >
                  {link.label}
                  <ExternalLink className="size-2.5" aria-hidden />
                </a>
              ) : null;
            })()}
          </div>
          {!visible.has("image") && (
            <div className="truncate text-xs text-subtle" title={container.image}>
              {container.image}
            </div>
          )}
        </div>
      </td>

      {visible.has("image") && (
        <td data-label={t("docker.columns.image.head")} className="px-4 py-3 md:whitespace-nowrap">
          <span
            className="block max-w-[16rem] truncate font-mono text-[11px] text-subtle"
            title={container.image}
          >
            {container.image}
          </span>
        </td>
      )}

      {visible.has("state") && (
        <td data-label={t("docker.columns.state.head")} className="px-4 py-3 md:whitespace-nowrap">
          {/*
            Durum, sağlık ve Docker'ın `Status` metni TEK SATIRDA. `status`
            eskiden alta ikinci bir satır olarak yazılıyordu ve satır
            yüksekliğini tek başına iki katına çıkarıyordu. Bilgi kaybı yok:
            metin aynı satırda, sığmazsa kesiliyor ve tamamı ipucunda.
          */}
          <span className="flex items-baseline gap-1.5">
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                STATE_STYLE[container.state] ?? "bg-line text-subtle"
              }`}
            >
              {container.state}
            </span>
            {container.health && (
              <span
                className={`shrink-0 text-[10px] ${
                  HEALTH_STYLE[container.health] ?? "text-subtle"
                }`}
              >
                {container.health}
              </span>
            )}
            <span
              title={container.status}
              className="min-w-0 text-[11px] text-subtle md:max-w-[10rem] md:truncate"
            >
              {container.status}
            </span>
          </span>
        </td>
      )}

      {visible.has("uptime") && (
        <td data-label={t("docker.columns.uptime.head")} className="px-4 py-3 text-xs text-subtle md:whitespace-nowrap">
          {formatUptime(container, t)}
        </td>
      )}

      {visible.has("cpu") && (
        <td data-label={t("docker.columns.cpu.head")} className="px-4 py-3 text-xs md:whitespace-nowrap">
          {container.cpuPct === null ? "—" : f.pct(container.cpuPct)}
        </td>
      )}

      {visible.has("memory") && (
        <td data-label={t("docker.columns.memory.head")} className="px-4 py-3 text-xs md:whitespace-nowrap">
          {container.memUsed === null ? (
            "—"
          ) : (
            <>
              {formatBytes(container.memUsed)}
              {container.memPct !== null && (
                <span className="text-subtle"> · {f.pct(container.memPct)}</span>
              )}
            </>
          )}
        </td>
      )}

      {visible.has("net") && (
        <td data-label={t("docker.columns.net.head")} className="px-4 py-3 font-mono text-[11px]">
          <IoCell inValue={container.netRx} outValue={container.netTx} />
        </td>
      )}

      {visible.has("disk") && (
        <td data-label={t("docker.columns.disk.head")} className="px-4 py-3 font-mono text-[11px]">
          <IoCell inValue={container.blkRead} outValue={container.blkWrite} />
        </td>
      )}

      {visible.has("ip") && (
        <td
          data-label={t("docker.columns.ip.head")}
          className="px-4 py-3 font-mono text-[11px] text-subtle md:whitespace-nowrap"
        >
          {container.ipAddress || (container.networkMode === "host" ? "host" : "—")}
        </td>
      )}

      {visible.has("ports") && (
        <td data-label={t("docker.columns.ports.head")} className="px-4 py-3 font-mono text-[11px] md:whitespace-nowrap">
          <PortCell container={container} publicHost={publicHost} />
        </td>
      )}

      {visible.has("restarts") && (
        <td data-label={t("docker.columns.restarts.head")} className="px-4 py-3 text-xs md:whitespace-nowrap">
          {container.restartCount === null ? (
            "—"
          ) : (container.restartsInWindow ?? 0) > 0 ? (
            <span className="text-danger">
              {t("docker.row.restartsInWindow", {
                count: container.restartCount,
                minutes: container.restartLoopWindowMinutes ?? 0,
                inWindow: container.restartsInWindow ?? 0,
              })}
            </span>
          ) : (
            container.restartCount
          )}
        </td>
      )}

      {visible.has("stack") && (
        <td data-label={t("docker.columns.stack.head")} className="px-4 py-3 text-[11px] text-subtle md:whitespace-nowrap">
          <span className="block md:max-w-[10rem] md:truncate" title={container.composeProject ?? ""}>
            {container.composeProject ?? "—"}
          </span>
        </td>
      )}

      {/*
        İşlem sütunu içeriği kadar yer kaplıyor (`md:w-px` + nowrap) ve düğmeler
        SARMIYOR. Eskiden `flex-wrap` vardı: sütun daraldığında altı düğme alt
        alta dizilip satırı 200 piksele çıkarıyordu — yani en çok işe yarayan
        sütun, kalabalık bir tabloda tablonun kendisini bozuyordu.
      */}
      <td data-label="" className="px-4 py-3 md:w-px md:whitespace-nowrap">
        <div className="flex flex-wrap items-center justify-end gap-1 max-md:justify-start md:flex-nowrap">
          <IconButton
            title={t("docker.row.details")}
            onClick={() => open(container, "genel")}
          >
            <Info className="size-3.5" />
          </IconButton>

          <IconButton
            title={t("docker.row.logs")}
            onClick={() => open(container, "loglar")}
          >
            <ScrollText className="size-3.5" />
          </IconButton>

          {canExec && container.state === "running" && (
            <IconButton
              title={t("docker.row.terminal")}
              onClick={() => open(container, "terminal")}
            >
              <TerminalIcon className="size-3.5" />
            </IconButton>
          )}

          {canAct && container.state !== "running" && (
            <IconButton
              title={t(ACTION_KEY.start)}
              disabled={busyId === container.id}
              onClick={() => void runAction(container, "start")}
            >
              <Play className="size-3.5" />
            </IconButton>
          )}

          {canAct && container.state === "running" && (
            <>
              <IconButton
                title={t(ACTION_KEY.restart)}
                disabled={busyId === container.id}
                onClick={() => void runAction(container, "restart")}
              >
                <RotateCw className="size-3.5" />
              </IconButton>
              <IconButton
                title={t(ACTION_KEY.pause)}
                disabled={busyId === container.id}
                onClick={() => void runAction(container, "pause")}
              >
                <Pause className="size-3.5" />
              </IconButton>
              <IconButton
                title={t(ACTION_KEY.stop)}
                danger
                disabled={busyId === container.id}
                onClick={() => void runAction(container, "stop")}
              >
                <Square className="size-3.5" />
              </IconButton>
            </>
          )}

          {canAct && container.state === "paused" && (
            <IconButton
              title={t(ACTION_KEY.unpause)}
              disabled={busyId === container.id}
              onClick={() => void runAction(container, "unpause")}
            >
              <Play className="size-3.5" />
            </IconButton>
          )}

          {/*
            Silme YALNIZCA durmuş container'da. Çalışanı silmek onu
            önce öldürmek demek ve bu, diğer simgelerin yanında tek
            tıkla durması gereken bir karar değil — önce Durdur.
            Bir yığın kaldırıldıktan sonra geride kalan tek
            container'ı temizlemek için asıl ihtiyaç duyulan yer
            burası; Temizlik sekmesindeki prune bütün durmuşları
            birden siliyor.
          */}
          {canAct && container.state !== "running" && (
            <IconButton
              title={t("docker.row.remove")}
              danger
              disabled={busyId === container.id}
              onClick={() => void removeContainer(container)}
            >
              <Trash2 className="size-3.5" />
            </IconButton>
          )}
        </div>
      </td>
    </tr>
  );
}

/**
 * Ağ ya da disk giriş/çıkış hücresi.
 *
 * Değerler container başlangıcından beri TOPLAM — `docker stats` ile aynı
 * büyüklük. Anlık hız merak ediliyorsa popup'ın Kaynaklar sekmesinde grafik
 * var; tabloda toplamı göstermek hem daha kararlı hem de "bu container ne
 * kadar trafik üretti" sorusuna doğrudan cevap.
 */
function IoCell({ inValue, outValue }: { inValue: number | null; outValue: number | null }) {
  if (inValue === null && outValue === null) return <span className="text-subtle">—</span>;

  return (
    <span className="whitespace-nowrap">
      <span className="text-subtle">↓</span>
      {formatBytes(inValue ?? 0)}{" "}
      <span className="text-subtle">↑</span>
      {formatBytes(outValue ?? 0)}
    </span>
  );
}

/**
 * "8 saat", "3 gün" — Docker'ın `Status` metnindeki İngilizceyi kullanmıyoruz.
 *
 * Durmuş container'da başlangıç zamanı anlamsız; oluşturma zamanına düşmek de
 * yanıltıcı olurdu, bu yüzden tire gösteriliyor.
 */
function formatUptime(container: ContainerView, t: TFunction): string {
  if (container.state !== "running") return "—";

  const saniye = Math.floor(Date.now() / 1000) - container.createdAt;
  if (saniye < 0) return "—";
  if (saniye < 60) return t("docker.row.uptime.seconds", { count: saniye });
  if (saniye < 3600) return t("docker.row.uptime.minutes", { count: Math.floor(saniye / 60) });
  if (saniye < 86400) return t("docker.row.uptime.hours", { count: Math.floor(saniye / 3600) });
  return t("docker.row.uptime.days", { count: Math.floor(saniye / 86400) });
}

export function IconButton({
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
        danger ? "hover:border-danger hover:text-danger" : "hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
