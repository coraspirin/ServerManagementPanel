"use client";

import { useState } from "react";
import dynamicImport from "next/dynamic";
import {
  Activity,
  Braces,
  Boxes,
  FileCode2,
  FolderTree,
  Info,
  Network,
  ScrollText,
  SlidersHorizontal,
  Terminal as TerminalIcon,
} from "lucide-react";

import { Modal } from "@/components/Modal";
import { ComposeSection } from "./ComposeSection";
import { LogViewer } from "./LogViewer";
import { EnvTab } from "./detail/EnvTab";
import { FilesTab } from "./detail/FilesTab";
import { GenerateTab } from "./detail/GenerateTab";
import { GeneralTab } from "./detail/GeneralTab";
import { InspectTab } from "./detail/InspectTab";
import { NetworkTab } from "./detail/NetworkTab";
import { ResourcesTab } from "./detail/ResourcesTab";
import { useContainerDetail } from "./detail/useDetail";
import { useT } from "@/lib/i18n/client";

/**
 * Bir container hakkında bilinen her şey, tek pencerede.
 *
 * Öncesinde üç ayrı modal vardı — detay, loglar, terminal — ve her biri
 * tabloda 14 pikselik ayrı bir simgenin arkasındaydı. Yedi özdeş simgenin
 * arasında duran bir "i" düğmesi keşfedilmiyor; kullanıcı "Docker ekranı daha
 * detaylı olabilir" derken eksik olan veri değil, ona giden yoldu. Veri zaten
 * toplanıyordu.
 *
 * M3.20'de "Genel" sekmesi de kendi içinde bölündü. 631 satırlık tek bir
 * kaydırma sütunu olmuştu: ağ ayarı, sağlık, compose düzenleyici, runbook,
 * ortam değişkenleri ve ham JSON alt alta. Aranan şeye ulaşmak için ekranı
 * gezmek gerekiyordu — passbolt olayında container'ın hiçbir ağa bağlı
 * OLMADIĞI bilgisi ekrandaydı ama kimse görmedi.
 */

/**
 * Terminal yalnızca sekmesine geçilince yüklenir.
 *
 * xterm.js ve CSS'i, yalnızca yapılandırmaya bakan birine ödetmenin anlamı
 * yok — bu gerekçe eskiden Docker sayfasının tamamı için geçerliydi ve
 * çekmecede de aynen geçerli.
 */
const TerminalPane = dynamicImport(
  () => import("./TerminalPane").then((m) => m.TerminalPane),
  { ssr: false, loading: () => <TerminalLoading /> },
);

function TerminalLoading() {
  const t = useT();
  return <p className="text-sm text-subtle">{t("docker.drawer.terminalLoading")}</p>;
}

export type DrawerTab =
  | "genel"
  | "compose"
  | "uret"
  | "ag"
  | "ortam"
  | "dosyalar"
  | "kaynaklar"
  | "loglar"
  | "terminal"
  | "inspect";

const TABS = [
  { id: "genel", label: "docker.drawer.tab.genel", icon: Info },
  { id: "compose", label: "docker.drawer.tab.compose", icon: SlidersHorizontal },
  { id: "uret", label: "docker.drawer.tab.uret", icon: FileCode2 },
  { id: "ag", label: "docker.drawer.tab.ag", icon: Network },
  { id: "ortam", label: "docker.drawer.tab.ortam", icon: Boxes },
  { id: "dosyalar", label: "docker.drawer.tab.dosyalar", icon: FolderTree },
  { id: "kaynaklar", label: "docker.drawer.tab.kaynaklar", icon: Activity },
  { id: "loglar", label: "docker.drawer.tab.loglar", icon: ScrollText },
  { id: "terminal", label: "docker.drawer.tab.terminal", icon: TerminalIcon },
  { id: "inspect", label: "docker.drawer.tab.inspect", icon: Braces },
] as const;

export type DrawerContainer = {
  id: string;
  name: string;
  state: string;
  composeProject: string | null;
};

export function ContainerDrawer({
  container,
  canAct,
  canExec,
  canInstall,
  logTail,
  initialTab = "genel",
  onClose,
}: {
  container: DrawerContainer | null;
  canAct: boolean;
  canExec: boolean;
  /** `apps.install` — "yığın olarak kaydet" bu izne bağlı (M3.31). */
  canInstall: boolean;
  logTail: number;
  initialTab?: DrawerTab;
  onClose: () => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<DrawerTab>(initialTab);

  // Detay tek yerden okunuyor ve sekmelere dağıtılıyor; sekme değiştirmek ağ
  // trafiği üretmiyor ve iki sekme birbirini tutmayan veri gösteremiyor.
  const { data, error } = useContainerDetail(container?.id ?? null);

  // Terminal yalnızca ÇALIŞAN bir container'da anlamlı; durmuş bir container'da
  // exec başarısız olur. Sekmeyi göstermek yerine gizlemek, tıklandığında hata
  // veren bir sekme sunmaktan dürüst. Aynı gerekçe compose için: compose'a ait
  // olmayan bir container'da o sekme yalnızca bir özür metni gösterirdi.
  //
  // İkisi de LİSTE PROPUNDAN karar veriliyor, `detail`den değil: detay asenkron
  // geldiği için sekme çubuğu yüklendikten sonra genişleyip yerinden oynardı.
  const canShowTerminal = canExec && container?.state === "running";
  const canShowCompose = container?.composeProject !== null;

  const visible = TABS.filter((entry) => {
    if (entry.id === "terminal") return canShowTerminal;
    if (entry.id === "compose") return canShowCompose;
    // "Compose üret" tam olarak "Compose"un OLMADIĞI yerde çıkıyor (M3.31):
    // yığına ait bir container'da düzenlenecek gerçek dosya varken, ondan
    // türetilmiş ikinci bir dosya üretmeyi önermek kafa karıştırırdı.
    if (entry.id === "uret") return !canShowCompose;
    return true;
  });

  return (
    <Modal open={container !== null} title={container ? container.name : ""} onClose={onClose} wide>
      {container && (
        <div className="space-y-3">
          <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line">
            {visible.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTab(entry.id)}
                aria-current={tab === entry.id ? "page" : undefined}
                className={`-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${
                  tab === entry.id
                    ? "border-brand font-medium text-brand"
                    : "border-transparent text-subtle hover:text-ink"
                }`}
              >
                <entry.icon className="size-3.5" aria-hidden />
                {t(entry.label)}
              </button>
            ))}
          </div>

          {/*
            Loglar ve terminal detay çağrısını BEKLEMİYOR: ikisi de yalnızca
            container kimliğine ihtiyaç duyuyor ve bir sorunu incelerken en
            acil açılan sekmeler onlar.
          */}
          {tab === "loglar" && (
            <LogViewer
              key={`${container.id}-log`}
              containerId={container.id}
              containerName={container.name}
              tail={logTail}
            />
          )}

          {tab === "terminal" && canShowTerminal && (
            <TerminalPane
              key={`${container.id}-term`}
              containerId={container.id}
              containerName={container.name}
            />
          )}

          {tab === "compose" && (
            <ComposeSection
              key={`${container.id}-compose`}
              containerId={container.id}
              composeProject={container.composeProject}
              canAct={canAct}
            />
          )}

          {tab === "uret" && !canShowCompose && (
            <GenerateTab
              key={`${container.id}-uret`}
              containerId={container.id}
              containerName={container.name}
              canInstall={canInstall}
            />
          )}

          {tab === "dosyalar" && (
            <FilesTab key={`${container.id}-dosya`} containerId={container.id} canAct={canAct} />
          )}

          {/*
            Kaynak grafikleri container ADIYLA sorgulanıyor: metrikler adla
            yazıldığı için container yeniden yaratılsa bile geçmiş kopmuyor.
          */}
          {tab === "kaynaklar" && (
            <ResourcesTab key={`${container.id}-kaynak`} containerName={container.name} />
          )}

          {DETAY_SEKMELERI.has(tab) && (
            <>
              {error && <p className="text-sm text-danger">{error}</p>}
              {!error && !data && <p className="text-sm text-subtle">{t("common.states.loadingInline")}</p>}

              {data && tab === "genel" && (
                <GeneralTab
                  containerId={container.id}
                  detail={data.detail}
                  impact={data.impact}
                  runbook={data.runbook}
                  canAct={canAct}
                />
              )}

              {data && tab === "ag" && <NetworkTab detail={data.detail} />}
              {data && tab === "ortam" && <EnvTab env={data.detail.env} />}
              {data && tab === "inspect" && <InspectTab raw={data.raw} />}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

/** `/detail` yanıtına ihtiyaç duyan sekmeler — yükleme/hata durumunu paylaşırlar. */
const DETAY_SEKMELERI = new Set<DrawerTab>(["genel", "ag", "ortam", "inspect"]);
