"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Plus } from "lucide-react";
import { ContainerDrawer, type DrawerTab } from "@/components/docker/ContainerDrawer";
import { ContainerCreateDialog } from "@/components/docker/ContainerCreateDialog";
import { PrunePanel } from "@/components/docker/PrunePanel";
import {
  ResourcePanel,
  UnusedSummary,
  useResources,
} from "@/components/docker/ResourcePanels";
import { NetworkGraph } from "@/components/docker/NetworkGraph";
import { NetworkPanel } from "@/components/docker/NetworkPanel";
import { BulkBar } from "@/components/docker/BulkBar";
import { StackPanel } from "@/components/docker/StackPanel";
import { TabToolbar, type PruneOption } from "@/components/docker/TabToolbar";
import { ContainerRow, type RowHandlers } from "@/components/docker/ContainerRow";
import { ColumnPicker, useColumns, type ColumnDef } from "@/components/docker/ColumnPicker";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import { fold } from "@/lib/text";
import type { ContainerView, DockerOverview } from "@/lib/docker/types";
import type { ContainerAction, ResourceKind } from "@/lib/providers/types";
import { useFormat, useT } from "@/lib/i18n/client";
import { Rich } from "@/lib/i18n/rich";
import type { MessageKey } from "@/lib/i18n/translate";

type Tab = "containers" | "stack" | ResourceKind | "cleanup";

/**
 * Sekmeler (M3.38: çoğul ekleri kaldırıldı).
 *
 * "Container'lar" yerine "Container": sekme adı bir kategori adı, sayı bildirimi
 * değil — ve Türkçe kesme işaretiyle çoğullanan yabancı sözcükler sekme
 * çubuğunda yer harcamaktan başka bir şey yapmıyordu.
 */
const TABS: { id: Tab; labelKey: MessageKey }[] = [
  { id: "containers", labelKey: "docker.tabs.containers" },
  { id: "stack", labelKey: "docker.tabs.stack" },
  { id: "image", labelKey: "docker.tabs.image" },
  { id: "volume", labelKey: "docker.tabs.volume" },
  { id: "network", labelKey: "docker.tabs.network" },
  { id: "cleanup", labelKey: "docker.tabs.cleanup" },
];

/**
 * Container tablosunun sütunları (M3.24).
 *
 * `fixed: false` = varsayılan olarak GİZLİ. Ad, durum ve işlemler listeden
 * çıkarılamıyor; onlarsız tablo bir tablo olmaktan çıkar.
 */
type SortKey = "name" | "state" | "cpu" | "memory" | "restarts";

/**
 * Tablo sütunu: seçicideki adı (`label`), tablodaki başlığı (`head`) ve
 * sıralanabiliyorsa anahtarı.
 *
 * İkisi ayrı çünkü seçicide açıklayıcı ad ("Yeniden başlatma") okunaklı,
 * tablo başlığında ise yer kaplıyor ("Restart").
 */
type TableColumn = ColumnDef & { head: string; sort?: SortKey };

/**
 * Sütunların yapısı. Seçicideki adı `docker.columns.<id>.label`, tablo başlığı
 * `docker.columns.<id>.head` — ikisi de dil dosyasında.
 */
const COLUMN_DEFS: { id: string; fixed?: boolean; sort?: SortKey }[] = [
  { id: "image" },
  { id: "state", sort: "state" },
  { id: "uptime", fixed: false },
  { id: "cpu", sort: "cpu" },
  { id: "memory", sort: "memory" },
  { id: "net", fixed: false },
  { id: "disk", fixed: false },
  { id: "ip", fixed: false },
  { id: "ports" },
  { id: "restarts", sort: "restarts" },
  { id: "stack", fixed: false },
];

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

/** Durdurma ve yeniden başlatma hizmet kesintisi demektir — onay isteriz. */
const NEEDS_CONFIRM: ContainerAction[] = ["stop", "restart"];

/** Adresten gelen sekme adı geçerliyse onu döndürür, değilse Container. */
function normalizeTab(raw: string): Tab {
  return TABS.some((entry) => entry.id === raw) ? (raw as Tab) : "containers";
}

export function DockerScreen({
  initial,
  initialTab = "",
  showStoppedDefault,
  refreshSeconds,
  logTailLines,
  publicHost,
  canAct,
  canExec,
  canInstall,
  canService,
}: {
  initial: DockerOverview;
  /** Adresten gelen sekme (`?tab=`); geçersizse Container açılır. */
  initialTab?: string;
  showStoppedDefault: boolean;
  refreshSeconds: number;
  logTailLines: number;
  /** `docker.public_host` ayarı; boşsa tarayıcının adresi kullanılır. */
  publicHost: string;
  canAct: boolean;
  canExec: boolean;
  /** `apps.install` — üretilen compose'u yığın olarak kaydetme izni (M3.31). */
  canInstall: boolean;
  /** `host.service` — yığın compose komutları bu izne bağlı (M3.37). */
  canService: boolean;
}) {
  const t = useT();
  const f = useFormat();
  const [data, setData] = useState(initial);
  const [tab, setTab] = useState<Tab>(() => normalizeTab(initialTab));
  const [showStopped, setShowStopped] = useState(showStoppedDefault);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  /*
    "Konteyner Ekle" penceresi (M3.46) ve sonuç bildirimi.

    Sonuç ayrı bir durumda tutuluyor çünkü pencere kapandıktan SONRA da
    görünmesi gerekiyor: kullanıcı oluşturduğu container'ı listede ararken
    "oluşturuldu ama başlatılamadı" uyarısını görebilmeli.
  */
  const [ekleAcik, setEkleAcik] = useState(false);
  const [ekleSonucu, setEkleSonucu] = useState<string | null>(null);

  /*
    Yenile düğmesinin jetonu (M3.38). Alt bileşenler veriyi kendileri çekiyor;
    onlara "şimdi tekrar çek" demenin en ucuz yolu değişen bir bağımlılık.
  */
  const [refreshToken, setRefreshToken] = useState(0);

  /**
   * Toplu işlem seçimi (M3.30) — id kümesi.
   *
   * Satır nesnesi değil ID tutuluyor: tablo beş saniyede bir tazeleniyor ve
   * nesneler her tazelemede yeniden yaratılıyor. Nesne tutmak seçimi ilk
   * tazelemede bayat veriye bağlardı.
   */
  const [secili, setSecili] = useState<ReadonlySet<string>>(() => new Set());

  const secimiDegistir = (id: string) =>
    setSecili((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  // Üç ayrı pencere yerine tek çekmece; hangi sekmeyle açılacağını tıklanan
  // düğme söylüyor (ada tıklamak "Genel", log simgesi "Loglar" açar).
  const [drawer, setDrawer] = useState<{ container: ContainerView; tab: DrawerTab } | null>(null);
  const open = (container: ContainerView, tab: DrawerTab) => setDrawer({ container, tab });

  // Kaynak listeleri yalnızca ilgili sekmeye geçilince çekilir: container
  // tablosunu açan herkes için üç ek Docker çağrısı yapmanın anlamı yok.
  const resources = useResources(tab !== "containers" && tab !== "stack");

  /*
    Ağ sekmesi iki görünüm sunuyor: tablo (oluşturma, bağlama, silme) ve harita
    ("kim kiminle konuşabiliyor" için).

    Varsayılan M3.41'de LİSTEYE çevrildi. Harita topoloji sorusunu iyi
    cevaplıyor ama sekmedeki işlerin çoğu — ağ oluşturmak, container bağlamak,
    subnet'e bakmak — tabloda yapılıyor ve kullanıcı her seferinde önce görünüm
    değiştirmek zorunda kalıyordu.
  */
  const [agGorunumu, setAgGorunumu] = useState<"harita" | "liste">("liste");

  /*
    Satırın geri çağrıları tek nesnede: `ContainerRow` hem burada hem Stack
    sekmesinde kullanılıyor ve dört ayrı prop'u iki yerde ayrı ayrı geçirmek,
    birinde unutulacak bir adım olurdu.
  */
  const rowHandlers: RowHandlers = {
    open,
    runAction: (container, action) => void runAction(container, action),
    removeContainer: (container) => void removeContainer(container),
    toggleSelect: secimiDegistir,
  };

  // Sütun adları dile bağlı; dizi yalnızca dil değişince yeniden kuruluyor —
  // `useColumns` diziyi bağımlılık olarak kullanıyor.
  const COLUMNS = useMemo<TableColumn[]>(
    () =>
      COLUMN_DEFS.map((column) => ({
        ...column,
        label: t(`docker.columns.${column.id}.label` as MessageKey),
        head: t(`docker.columns.${column.id}.head` as MessageKey),
      })),
    [t],
  );
  const { visible, toggle, reset } = useColumns(COLUMNS);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "name",
    dir: "asc",
  });

  const sirala = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    );

  async function runAction(container: ContainerView, action: ContainerAction) {
    // Onay cümlesi eylem başına AYRI anahtar: eskiden eylem adına ek
    // yapıştırılıyordu ve "Durdur" → "durdurılsın mı?" gibi bozuk Türkçe
    // çıkıyordu; başka dillerde bu yöntem hiç işlemezdi.
    const onay =
      action === "stop"
        ? t("docker.screen.confirmStop", { name: container.name })
        : t("docker.screen.confirmRestart", { name: container.name });
    if (NEEDS_CONFIRM.includes(action) && !confirm(onay)) {
      return;
    }

    setBusyId(container.id);
    setActionError(null);
    try {
      const response = await fetch(`/api/docker/${encodeURIComponent(container.id)}/action`, {
        method: "POST",
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: JSON.stringify({ action }),
      });
      const payload = (await response.json()) as DockerOverview & { error?: string };
      if (!response.ok) setActionError(payload.error ?? t("common.errors.actionFailed"));
      else setData(payload);
    } catch {
      setActionError(t("common.errors.network"));
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Container'ı sil.
   *
   * `runAction`tan ayrı: o route bir `ContainerAction` alıp
   * `provider.action()`e gidiyor, silme ise farklı bir imza ve farklı bir
   * route. Onay metni de ayrı olmalı — diğer eylemler geri alınabilir, bu
   * değil.
   */
  async function removeContainer(container: ContainerView) {
    if (!confirm(t("docker.screen.confirmRemove", { name: container.name }))) {
      return;
    }

    setBusyId(container.id);
    setActionError(null);
    try {
      const response = await fetch(`/api/docker/${encodeURIComponent(container.id)}/remove`, {
        method: "POST",
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
      });
      const payload = (await response.json()) as DockerOverview & { error?: string };
      if (!response.ok) setActionError(payload.error ?? t("docker.screen.removeFailed"));
      else setData(payload);
    } catch {
      setActionError(t("common.errors.network"));
    } finally {
      setBusyId(null);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/docker", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (response.ok) setData((await response.json()) as DockerOverview);
      } catch {
        // Ağ hatası: son bilinen tablo ekranda kalır.
      }
    };
    const timer = setInterval(load, Math.max(5, refreshSeconds) * 1000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [refreshSeconds]);

  const filtered = useMemo(() => {
    // `fold()`: komut paletiyle aynı normalleştirme — "sifre" yazan biri
    // "şifre"yi bulabilmeli. İki ayrı arama davranışı öğretmenin anlamı yok.
    const q = fold(query.trim());
    return data.containers.filter((container) => {
      if (!showStopped && container.state !== "running") return false;
      if (!q) return true;
      return [container.name, container.image, container.composeProject ?? ""].some((text) =>
        fold(text).includes(q),
      );
    });
  }, [data.containers, showStopped, query]);

  /**
   * Sıralanmış düz liste.
   *
   * Burada bir zamanlar compose projesine göre GRUPLAMA vardı ve kaldırıldı
   * (M3.37). Gerekçe kullanıcıdan geldi: sunucudaki 13 compose projesinin 8'i
   * tek container'lık ve "defterim, home assistant, zigbee2mqtt aynı şey değil
   * ki gruplansın". Compose ile başlatılmış olmak bir uygulamayı yığın
   * yapmıyor; grup başlıkları birbiriyle ilgisi olmayan uygulamaları anlamlı
   * bir ortaklıkları varmış gibi gösteriyordu.
   *
   * `composeProject` teknik bir alan — bir SÜTUN olabilir (var, "Yığın"),
   * listeyi bölme ölçütü olamaz. Yığın yönetimi artık kendi sekmesinde.
   */
  const sirali = useMemo(() => {
    const yon = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sort.key) {
        case "cpu":
          return ((a.cpuPct ?? -1) - (b.cpuPct ?? -1)) * yon;
        case "memory":
          return ((a.memUsed ?? -1) - (b.memUsed ?? -1)) * yon;
        case "restarts":
          return ((a.restartCount ?? -1) - (b.restartCount ?? -1)) * yon;
        case "state":
          return f.compare(a.state, b.state) * yon;
        default:
          return f.compare(a.name, b.name) * yon;
      }
    });
  }, [filtered, sort, f]);

  /**
   * Toplu işleme girebilecek satırlar: YALNIZCA süzülmüş ve kilitsiz olanlar.
   *
   * Süzgeç dışında kalan bir satırı işleme sokmak sürpriz olurdu — "durmuşları
   * göster"i kapattıktan sonra hâlâ seçili duran bir container'ı durdurmak,
   * kullanıcının ekranda görmediği bir şeye dokunmak demek. Bu yüzden seçim
   * kümesi korunuyor ama İŞLEM her zaman görünür kesişimde yapılıyor.
   */
  const secilebilir = useMemo(() => filtered.filter((entry) => !entry.locked), [filtered]);
  const secilenler = useMemo(
    () => secilebilir.filter((entry) => secili.has(entry.id)),
    [secilebilir, secili],
  );

  const hepsiSecili = secilebilir.length > 0 && secilenler.length === secilebilir.length;

  const hepsiniSec = () =>
    setSecili((prev) => {
      const next = new Set(prev);
      if (hepsiSecili) for (const entry of secilebilir) next.delete(entry.id);
      else for (const entry of secilebilir) next.add(entry.id);
      return next;
    });

  // Seçim sütunu yalnızca yetki varken çıkıyor: seçebilip hiçbir şey
  // yapamamak, işe yaramayan bir sütun demek.
  const secimSutunu = canAct;

  /*
    Sekme başına budama kapsamı (M3.38). Container ve Stack sekmelerinde YOK:
    durmuş container'ları budamak bir yığının parçasını sessizce silmek
    olabilir ve o karar Temizlik sekmesinin açık uyarısını hak ediyor.
  */
  const pruneOption: PruneOption | undefined =
    tab === "image"
      ? { scope: "images-unused", label: t("docker.screen.pruneImages"), danger: false }
      : tab === "volume"
        ? {
            scope: "volumes",
            label: t("docker.screen.pruneVolumes"),
            danger: true,
          }
        : tab === "network"
          ? { scope: "networks", label: t("docker.screen.pruneNetworks"), danger: false }
          : undefined;

  const aramaIpucu =
    tab === "stack"
      ? t("docker.screen.search.stack")
      : tab === "image"
        ? t("docker.screen.search.image")
        : tab === "volume"
          ? t("docker.screen.search.volume")
          : tab === "network"
            ? t("docker.screen.search.network")
            : t("docker.screen.search.containers");

  /** Yenile: kaynak listeleri kendi uçlarından, Stack kendi jetonundan tazelenir. */
  const yenile = () => {
    setRefreshToken((value) => value + 1);
    resources.refresh();
  };

  const loops = data.containers.filter((c) => (c.restartsInWindow ?? 0) > 0);
  const running = data.containers.filter((c) => c.state === "running").length;

  if (data.error) {
    return (
      <div className="rounded-lg border border-danger/40 bg-surface px-5 py-4">
        <p className="text-sm text-danger">{data.error}</p>
        <p className="mt-2 text-xs text-subtle">
          <Rich
            text={t("docker.screen.socketHint")}
            values={{
              sock: <code className="font-mono">/var/run/docker.sock</code>,
              gid: <code className="font-mono">DOCKER_GID</code>,
            }}
          />
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {loops.length > 0 && (
        <div className="flex gap-2 rounded-lg border border-danger/40 bg-surface px-5 py-4">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          <div className="text-sm">
            <p className="font-medium text-danger">{t("docker.screen.loopsTitle")}</p>
            <p className="mt-0.5 text-xs text-subtle">
              {t("docker.screen.loopsNote", {
                list: loops
                  .map((c) =>
                    t("docker.screen.loopItem", {
                      name: c.name,
                      minutes: c.restartLoopWindowMinutes ?? 0,
                      count: c.restartsInWindow ?? 0,
                    }),
                  )
                  .join(" · "),
              })}
            </p>
          </div>
        </div>
      )}

      {actionError && (
        <p className="rounded-md border border-danger/40 bg-surface px-4 py-2 text-sm text-danger">
          {actionError}
        </p>
      )}

      {ekleSonucu && (
        <div className="flex flex-wrap items-start gap-2 rounded-md border border-ok/40 bg-surface px-4 py-2 text-sm text-ok">
          <p className="min-w-0 flex-1">{ekleSonucu}</p>
          <button
            type="button"
            onClick={() => setEkleSonucu(null)}
            className="shrink-0 text-xs text-subtle underline transition-colors hover:text-ink"
          >
            {t("docker.screen.dismiss")}
          </button>
        </div>
      )}

      <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            aria-current={tab === entry.id ? "page" : undefined}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${
              tab === entry.id
                ? "border-brand font-medium text-brand"
                : "border-transparent text-subtle hover:text-ink"
            }`}
          >
            {t(entry.labelKey)}
          </button>
        ))}
      </div>

      {tab !== "cleanup" && (
        <TabToolbar
          query={query}
          onQuery={setQuery}
          placeholder={aramaIpucu}
          onRefresh={yenile}
          prune={pruneOption}
          canAct={canAct}
        >
          {tab === "containers" && (
            <>
              {/*
                Ekleme düğmesi araç çubuğunun İÇİNDE: container eklemek de
                listeye yapılan bir iş ve ayrı bir yere konması, kullanıcının
                onu listeden çıkmadan bulamaması demekti.
              */}
              {canAct && (
                <button
                  type="button"
                  onClick={() => setEkleAcik(true)}
                  className="inline-flex items-center gap-1 rounded-md border border-brand bg-brand/10 px-2 py-1.5 text-xs font-medium text-brand transition-colors hover:bg-brand/20"
                >
                  <Plus className="size-3.5" aria-hidden />
                  {t("docker.screen.addContainer")}
                </button>
              )}
              <label className="flex items-center gap-1.5 text-xs text-subtle">
                <input
                  type="checkbox"
                  checked={showStopped}
                  onChange={(e) => setShowStopped(e.target.checked)}
                  className="size-3.5 accent-[var(--brand)]"
                />
                {t("docker.screen.showStopped")}
              </label>
              <ColumnPicker
                columns={COLUMNS}
                visible={visible}
                onToggle={toggle}
                onReset={reset}
              />
              <span className="ml-auto text-xs font-medium">
                {t("docker.screen.runningCount", { running, total: data.containers.length })}
              </span>
            </>
          )}
        </TabToolbar>
      )}

      {tab !== "containers" && tab !== "stack" && resources.error && (
        <p className="rounded-md border border-danger/40 bg-surface px-4 py-2 text-sm text-danger">
          {resources.error}
        </p>
      )}

      {tab !== "containers" && tab !== "stack" && !resources.data && !resources.error && (
        <p className="text-sm text-subtle">{t("common.states.loadingInline")}</p>
      )}

      {tab === "network" && resources.data && (
        <div className="flex flex-wrap gap-1">
          {(["harita", "liste"] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => setAgGorunumu(entry)}
              className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                agGorunumu === entry
                  ? "border-brand bg-brand/10 font-medium text-brand"
                  : "border-line text-subtle hover:text-ink"
              }`}
            >
              {entry === "harita" ? t("docker.screen.viewMap") : t("docker.screen.viewList")}
            </button>
          ))}
        </div>
      )}

      {tab === "network" && resources.data && agGorunumu === "harita" && (
        <NetworkGraph
          networks={resources.data.networks}
          containers={data.containers}
          onSelect={(name) => {
            const hedef = data.containers.find((entry) => entry.name === name);
            if (hedef) open(hedef, "ag");
          }}
        />
      )}

      {tab === "network" && resources.data && agGorunumu === "liste" && (
        <NetworkPanel
          networks={resources.data.networks}
          containers={data.containers}
          query={query}
          canAct={canAct}
          onChanged={(payload) => resources.setData(payload as typeof resources.data)}
          onOpenContainer={(name) => {
            const hedef = data.containers.find((entry) => entry.name === name);
            if (hedef) open(hedef, "genel");
          }}
        />
      )}

      {(tab === "image" || tab === "volume") &&
        resources.data && (
          <ResourcePanel
            kind={tab}
            data={resources.data}
            canAct={canAct}
            onChanged={resources.setData}
            onOpenContainer={(name) => {
              const hedef = data.containers.find((entry) => entry.name === name);
              if (hedef) open(hedef, "genel");
            }}
            onOpenStack={(project) => {
              setTab("stack");
              setQuery(project);
            }}
          />
        )}

      {tab === "stack" && (
        <StackPanel
          query={query}
          visible={visible}
          publicHost={publicHost}
          canAct={canAct}
          canExec={canExec}
          canService={canService}
          canInstall={canInstall}
          rowHandlers={rowHandlers}
          refreshToken={refreshToken}
        />
      )}

      {tab === "cleanup" && resources.data && (
        <>
          <UnusedSummary unused={resources.data.unused} />
          {canAct && <PrunePanel />}
        </>
      )}

      {tab === "containers" && (
        <>
      {secimSutunu && secilenler.length > 0 && (
        <BulkBar
          selected={secilenler}
          onDone={setData}
          onClear={() => setSecili(new Set())}
        />
      )}

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-surface px-5 py-8 text-center text-sm text-subtle">
          {t("docker.screen.noMatch")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="rtable w-full min-w-[52rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-subtle">
                {secimSutunu && (
                  <th className="w-8 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={hepsiSecili}
                      /*
                        Kısmi seçimde üçüncü bir görsel durum: React'ta
                        `indeterminate` bir öznitelik değil, DOM özelliği —
                        yalnızca ref ile verilebiliyor.
                      */
                      ref={(el) => {
                        if (el) {
                          el.indeterminate =
                            secilenler.length > 0 && secilenler.length < secilebilir.length;
                        }
                      }}
                      onChange={hepsiniSec}
                      aria-label={t("docker.screen.selectAllAria")}
                      title={t("docker.screen.selectAllTitle")}
                      className="size-3.5 accent-[var(--brand)]"
                    />
                  </th>
                )}
                <SortHeader label={t("docker.screen.colContainer")} active={sort} id="name" onSort={sirala} />

                {/*
                  Başlıklar COLUMNS'tan ÜRETİLİYOR, tek tek yazılmıyor.

                  Yazıldıkları hâlde Image başlığı unutulmuştu (M3.24) ve
                  gövdede hücre varken başlıkta karşılığı yoktu: adın sağındaki
                  her sütun bir kayıyor, "Durum" başlığı imajın, "CPU" çalışma
                  süresinin üstünde duruyordu. Başlık koşulları ile hücre
                  koşulları yüz satır arayla kopyalanmıştı — ayrışmaları an
                  meselesiydi.

                  Üretim, başlık SAYISININ görünen sütun sayısıyla aynı
                  olmasını garanti ediyor; kalan tek risk hücrelerin sırası ve
                  o da COLUMNS ile aynı sırada duruyor.
                */}
                {COLUMNS.filter((column) => visible.has(column.id)).map((column) =>
                  column.sort ? (
                    <SortHeader
                      key={column.id}
                      label={column.head}
                      active={sort}
                      id={column.sort}
                      onSort={sirala}
                    />
                  ) : (
                    <th key={column.id} className="whitespace-nowrap px-4 py-2.5 font-medium">
                      {column.head}
                    </th>
                  ),
                )}

                <th className="whitespace-nowrap px-4 py-2.5 text-right font-medium">
                  {t("docker.screen.colActions")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sirali.map((container) => (
                <ContainerRow
                  key={container.id}
                  container={container}
                  visible={visible}
                  publicHost={publicHost}
                  canAct={canAct}
                  canExec={canExec}
                  busyId={busyId}
                  selected={secili.has(container.id)}
                  showSelect={secimSutunu}
                  handlers={rowHandlers}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-subtle">
        {t("docker.screen.footer")}
      </p>
        </>
      )}

      {canAct && (
        <ContainerCreateDialog
          open={ekleAcik}
          onClose={() => setEkleAcik(false)}
          onCreated={(payload, message) => {
            setData(payload);
            setEkleSonucu(message);
            setActionError(null);
            /*
              Yeni container DURMUŞ olabilir: kullanıcı "oluşturduktan sonra
              başlat"ı kapatmış ya da başlatma hata vermiş olabilir. Süzgeç
              açık kalsaydı "oluşturuldu" mesajı, listede görünmeyen bir
              container'ı anlatıyor olurdu.
            */
            setShowStopped(true);
            setTab("containers");
          }}
        />
      )}

      {/*
        `key`: çekmece kapanmadan başka bir container'a geçilirse (ör. arama
        sonucundan başka bir satıra tıklanırsa) sekme durumu ve açık log akışı
        sıfırlansın. Aksi halde yeni container'ın penceresi eskisinin
        sekmesinde açılır ve log akışı bir an eski container'ı gösterir.
      */}
      <ContainerDrawer
        key={drawer ? `${drawer.container.id}-${drawer.tab}` : "yok"}
        container={drawer?.container ?? null}
        initialTab={drawer?.tab ?? "genel"}
        canAct={canAct}
        canExec={canExec}
        canInstall={canInstall}
        logTail={logTailLines}
        onClose={() => setDrawer(null)}
      />
    </div>
  );
}

/**
 * Sıralanabilir sütun başlığı.
 *
 * Ok yönü sıralamanın YÖNÜNÜ değil, tıklanınca ne olacağını değil, şu anki
 * durumu gösteriyor — kullanıcı hangi sütuna göre sıralı olduğunu görmeden
 * tabloya güvenemez.
 */
function SortHeader({
  label,
  id,
  active,
  onSort,
}: {
  label: string;
  id: SortKey;
  active: { key: SortKey; dir: "asc" | "desc" };
  onSort: (key: SortKey) => void;
}) {
  const secili = active.key === id;

  return (
    <th className="whitespace-nowrap px-4 py-2.5 font-medium">
      <button
        type="button"
        onClick={() => onSort(id)}
        className={`flex items-center gap-1 transition-colors hover:text-ink ${
          secili ? "text-brand" : ""
        }`}
      >
        {label}
        <span className="text-[9px]">{secili ? (active.dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );
}

