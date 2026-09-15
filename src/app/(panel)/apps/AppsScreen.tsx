"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownUp,
  ChevronDown,
  ChevronUp,
  FolderPlus,
  LayoutGrid,
  Pencil,
  Plus,
  RadioTower,
  Search,
  Trash2,
} from "lucide-react";
import { Modal } from "@/components/Modal";
import {
  AppForm,
  type ContainerOption,
  appToForm,
  emptyAppForm,
  type AppFormValues,
  type MonitorOption,
} from "@/components/apps/AppForm";
import { AppTile } from "@/components/apps/AppTile";
import { CATEGORY_ICONS, categoryIcon } from "@/components/apps/categoryIcons";
import { BookmarkManager } from "@/components/home/BookmarkManager";
import { KioskManager } from "@/components/home/KioskManager";
import type { BookmarkGroup } from "@/lib/home/bookmarks";
import type { KioskTokenView } from "@/lib/home/kiosk";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/types";
import type { AppCard, AppCategory, AppGroup } from "@/lib/apps/types";
import type { WidgetActionDef, WidgetDef, WidgetState } from "@/lib/widgets/types";

/**
 * Uygulamalar ekranı (M2.1 + M2.2).
 *
 * Bütün liste sunucudan bir kerede geliyor ve her yazma işlemi yeni listeyi
 * DÖNDÜRÜYOR: kartlar birkaç düzine satır, ayrı bir yenileme turu ya da
 * istemci tarafı birleştirme mantığı kurmak kazançtan çok hata getirirdi.
 */

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

type Props = {
  initialGroups: AppGroup[];
  initialCategories: AppCategory[];
  monitors: MonitorOption[];
  containers: ContainerOption[];
  widgets: WidgetDef[];
  bookmarks: BookmarkGroup[];
  kioskTokens: KioskTokenView[];
  canManage: boolean;
  canManageKiosk: boolean;
  refreshSeconds: number;
};

export function AppsScreen({
  initialGroups,
  initialCategories,
  monitors,
  containers,
  widgets,
  bookmarks,
  kioskTokens,
  canManage,
  canManageKiosk,
  refreshSeconds,
}: Props) {
  const [groups, setGroups] = useState(initialGroups);
  const [categories, setCategories] = useState(initialCategories);
  const [query, setQuery] = useState("");
  // Sıralama kipi: açıkken kartlar açılmaz, taşınır (M2.4).
  const [sorting, setSorting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [widgetStates, setWidgetStates] = useState<Record<number, WidgetState>>({});
  const [widgetBusy, setWidgetBusy] = useState<number | null>(null);

  const [appModal, setAppModal] = useState<{
    open: boolean;
    id: number | null;
    discovered: boolean;
    widgetConfigured: boolean;
    values: AppFormValues;
  }>({ open: false, id: null, discovered: false, widgetConfigured: false, values: emptyAppForm() });

  const [categoryModal, setCategoryModal] = useState<{
    open: boolean;
    id: number | null;
    name: string;
    icon: string;
  }>({ open: false, id: null, name: "", icon: "" });

  const cardCount = groups.reduce((total, group) => total + group.cards.length, 0);

  /** Arama kartın adında, açıklamasında ve adresinde birden arar. */
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("tr");
    if (!needle) return groups;

    return groups
      .map((group) => ({
        ...group,
        cards: group.cards.filter((card) =>
          `${card.name} ${card.description} ${card.url}`.toLocaleLowerCase("tr").includes(needle),
        ),
      }))
      // Arama sırasında boş kategoriler gizleniyor; aksi halde sonuç listesi
      // eşleşmeyen başlıklarla dolar.
      .filter((group) => group.cards.length > 0);
  }, [groups, query]);

  /**
   * Durum noktalarını tazeler (M2.3).
   *
   * Modal açıkken de çalışıyor — yenilenen şey `groups`, formun kendi değerleri
   * ayrı bir state'te duruyor, yani kullanıcının yazdığı hiçbir şey ezilmiyor.
   */
  const refresh = useCallback(async (signal: AbortSignal) => {
    try {
      const response = await fetch("/api/apps", { signal, cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { groups: AppGroup[]; categories: AppCategory[] };
      setGroups(data.groups);
      setCategories(data.categories);
    } catch {
      // Ağ hatası: ekran son bilinen durumu göstermeye devam eder.
    }
  }, []);

  /**
   * Widget verisi kart başına AYRI çekiliyor (M2.6).
   *
   * Kart listesinin içine gömseydik, yavaş ya da erişilemeyen tek bir servis
   * bütün ekranın açılmasını geciktirirdi. Ayrı istekte her kart kendi hızında
   * dolar; sunucu tarafındaki önbellek de servisi yormayı engelliyor.
   */
  const widgetCards = useMemo(
    () => groups.flatMap((group) => group.cards).filter((card) => card.widgetType !== ""),
    [groups],
  );
  const widgetIds = widgetCards.map((card) => card.id).join(",");

  const loadWidgets = useCallback(async (ids: number[], signal: AbortSignal) => {
    const entries = await Promise.all(
      ids.map(async (id) => {
        try {
          const response = await fetch(`/api/apps/${id}/widget`, { signal, cache: "no-store" });
          if (!response.ok) return null;
          const data = (await response.json()) as { state: WidgetState };
          return [id, data.state] as const;
        } catch {
          return null;
        }
      }),
    );

    const next: Record<number, WidgetState> = {};
    for (const entry of entries) if (entry) next[entry[0]] = entry[1];

    // Birleştiriliyor, değiştirilmiyor: tek bir kart için çağrıldığında
    // (aksiyon sonrası) diğer kartların verisi silinmemeli. Silinmiş kartların
    // artıkları zararsız — çizim her zaman güncel kart listesinden gidiyor.
    setWidgetStates((previous) => ({ ...previous, ...next }));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const ids = widgetIds ? widgetIds.split(",").map(Number) : [];

    // İlk yükleme efekt içinde: sunucu tarafı render'a bağlamamak, yavaş bir
    // servisin sayfanın tamamını bekletmesini engelliyor.
    void (async () => {
      await loadWidgets(ids, controller.signal);
    })();

    const timer = setInterval(() => {
      void refresh(controller.signal);
      void loadWidgets(ids, controller.signal);
    }, Math.max(5, refreshSeconds) * 1000);

    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [refresh, refreshSeconds, loadWidgets, widgetIds]);

  /**
   * Yazma isteği. Başarılıysa yanıt gövdesini döndürür (hata durumunda null),
   * böylece çağıran taraf hem "oldu mu" bilgisini hem de ek alanları
   * (tarama özeti gibi) tek yerden alır.
   */
  async function send(
    url: string,
    method: string,
    body?: unknown,
  ): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setFormError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = (await response.json()) as Record<string, unknown>;

      if (!response.ok) {
        setFormError((data.error as string) ?? "İşlem başarısız.");
        return null;
      }
      if (Array.isArray(data.groups)) setGroups(data.groups as AppGroup[]);
      if (Array.isArray(data.categories)) setCategories(data.categories as AppCategory[]);
      return data;
    } catch {
      setFormError("Sunucuya ulaşılamadı.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveApp() {
    const values = appModal.values;
    const payload = {
      name: values.name,
      url: values.url,
      description: values.description,
      categoryId: values.categoryId === "" ? null : Number(values.categoryId),
      icon: values.icon,
      color: values.color,
      internalUrl: values.internalUrl,
      containerName: values.containerName,
      monitorId: values.monitorId === "" ? null : Number(values.monitorId),
      openNewTab: values.openNewTab,
      enabled: values.enabled,
      showOnLogin: values.showOnLogin,
      widgetType: values.widgetType,
      widgetConfig: values.widgetConfig,
    };

    const ok =
      appModal.id === null
        ? await send("/api/apps", "POST", payload)
        : await send(`/api/apps/${appModal.id}`, "PATCH", payload);

    if (ok) setAppModal((modal) => ({ ...modal, open: false }));
  }

  async function removeApp() {
    if (appModal.id === null) return;
    if (!confirm(`"${appModal.values.name}" kartı silinsin mi?`)) return;

    if (await send(`/api/apps/${appModal.id}`, "DELETE")) {
      setAppModal((modal) => ({ ...modal, open: false }));
    }
  }

  async function saveCategory() {
    const payload = { name: categoryModal.name, icon: categoryModal.icon };
    const ok =
      categoryModal.id === null
        ? await send("/api/apps/categories", "POST", payload)
        : await send(`/api/apps/categories/${categoryModal.id}`, "PATCH", payload);

    if (ok) setCategoryModal((modal) => ({ ...modal, open: false }));
  }

  async function removeCategory() {
    if (categoryModal.id === null) return;
    if (
      !confirm(
        `"${categoryModal.name}" kategorisi silinsin mi?\n\nKartlar silinmez, "Diğer" başlığına taşınır.`,
      )
    ) {
      return;
    }

    if (await send(`/api/apps/categories/${categoryModal.id}`, "DELETE")) {
      setCategoryModal((modal) => ({ ...modal, open: false }));
    }
  }

  async function move(kind: "apps" | "apps/categories", id: number, direction: -1 | 1) {
    await send(`/api/${kind}/${id}/move`, "POST", { direction });
  }

  /**
   * Etiket taraması (M2.5).
   *
   * Sonuç kısa bir bildirimle gösteriliyor: "değişiklik yok" da bir cevaptır —
   * düğmeye basıp hiçbir şey olmaması, çalışmadı mı çalıştı mı belirsiz bırakır.
   */
  async function discover() {
    setNotice(null);
    const data = await send("/api/apps/discover", "POST");
    if (!data) return;

    const skipped = (data.result as { skipped?: Record<string, string> } | undefined)?.skipped ?? {};
    const reasons = Object.entries(skipped)
      .map(([name, reason]) => `${name}: ${reason}`)
      .join(" · ");

    setNotice(`Tarama: ${data.summary as string}${reasons ? ` — ${reasons}` : ""}`);
  }

  /** Widget aksiyonu — Pi-hole'u devre dışı bırakmak gibi (M2.6). */
  async function runWidgetAction(card: AppCard, action: WidgetActionDef) {
    if (action.confirm && !confirm(action.confirm)) return;

    setWidgetBusy(card.id);
    setNotice(null);
    try {
      const response = await fetch(`/api/apps/${card.id}/widget`, {
        method: "POST",
        headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
        body: JSON.stringify({ action: action.key }),
      });
      const data = (await response.json()) as { message?: string; error?: string };
      setNotice(response.ok ? (data.message ?? "Tamam.") : (data.error ?? "İşlem başarısız."));

      // Aksiyon durumu değiştirdi; sunucudaki önbellek zaten temizlendi, tek
      // yapılacak yeniden okumak.
      const controller = new AbortController();
      await loadWidgets([card.id], controller.signal);
    } catch {
      setNotice("Sunucuya ulaşılamadı.");
    } finally {
      setWidgetBusy(null);
    }
  }

  function openNewApp(categoryId: number | null) {
    setFormError(null);
    setAppModal({
      open: true,
      id: null,
      discovered: false,
      widgetConfigured: false,
      values: { ...emptyAppForm(), categoryId: categoryId?.toString() ?? "" },
    });
  }

  function openEditApp(card: AppCard) {
    setFormError(null);
    setAppModal({
      open: true,
      id: card.id,
      discovered: card.source === "docker",
      widgetConfigured: card.widgetConfigured,
      values: appToForm(card),
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Kart ara"
            aria-label="Kart ara"
            // Süzülmüş listede sıra numaraları kaydığı için arama ve sıralama
            // aynı anda açık olamaz.
            disabled={sorting}
            className="w-full rounded-md border border-line bg-surface py-1.5 pl-8 pr-2.5 text-sm outline-none focus:border-brand disabled:opacity-50"
          />
        </label>

        <span className="text-sm text-subtle">{cardCount} kart</span>

        {canManage && (
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => void discover()}
              disabled={busy}
              title="Docker etiketlerini tarayıp kartları günceller"
              className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand disabled:opacity-50"
            >
              <RadioTower className="size-4" /> Şimdi tara
            </button>
            {cardCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  setSorting((value) => !value);
                  // Süzülmüş bir listede "bir sıra ilerlet" ne demek belli
                  // değil; sıralama daima tam liste üzerinde yapılır.
                  setQuery("");
                }}
                aria-pressed={sorting}
                className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  sorting ? "border-brand text-brand" : "border-line hover:border-brand"
                }`}
              >
                <ArrowDownUp className="size-4" /> {sorting ? "Bitir" : "Sırala"}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setFormError(null);
                setCategoryModal({ open: true, id: null, name: "", icon: "" });
              }}
              className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-brand"
            >
              <FolderPlus className="size-4" /> Kategori
            </button>
            <button
              type="button"
              onClick={() => openNewApp(null)}
              className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white"
            >
              <Plus className="size-4" /> Kart ekle
            </button>
          </div>
        )}
      </div>

      {notice && (
        <p className="flex items-start justify-between gap-3 rounded-md border border-line bg-surface px-4 py-2 text-sm">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="shrink-0 text-xs text-subtle transition-colors hover:text-ink"
          >
            kapat
          </button>
        </p>
      )}

      {formError && !appModal.open && !categoryModal.open && (
        <p className="rounded-md border border-danger/40 bg-surface px-4 py-2 text-sm text-danger">
          {formError}
        </p>
      )}

      {cardCount === 0 && categories.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-12 text-center">
          <LayoutGrid className="mx-auto size-7 text-subtle" aria-hidden />
          <h2 className="mt-3 font-semibold">Henüz kart yok</h2>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-subtle">
            Sunucudaki servislerin kısayolları burada toplanır. Home Assistant,
            Pi-hole ya da router arayüzüyle başlayabilirsin.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-surface px-5 py-8 text-center text-sm text-subtle">
          &quot;{query}&quot; ile eşleşen kart yok.
        </p>
      ) : (
        <div className="space-y-6">
          {visible.map((group) => {
            const Icon = categoryIcon(group.category?.icon ?? "");
            return (
              <section key={group.category?.id ?? "diger"}>
                <div className="mb-2 flex items-center gap-2">
                  <Icon className="size-4 text-subtle" aria-hidden />
                  <h2 className="text-sm font-semibold">
                    {group.category?.name ?? "Diğer"}
                  </h2>
                  <span className="text-xs text-subtle">{group.cards.length}</span>

                  {canManage && group.category && !sorting && (
                    <button
                      type="button"
                      onClick={() => {
                        setFormError(null);
                        setCategoryModal({
                          open: true,
                          id: group.category!.id,
                          name: group.category!.name,
                          icon: group.category!.icon,
                        });
                      }}
                      aria-label={`${group.category.name} kategorisini düzenle`}
                      className="rounded p-1 text-subtle transition-colors hover:text-ink"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                  )}

                  {sorting && group.category && (
                    <span className="flex gap-0.5">
                      {([-1, 1] as const).map((direction) => {
                        const position = categories.findIndex(
                          (category) => category.id === group.category!.id,
                        );
                        const Icon = direction === -1 ? ChevronUp : ChevronDown;
                        const blocked =
                          direction === -1
                            ? position <= 0
                            : position < 0 || position >= categories.length - 1;
                        return (
                          <button
                            key={direction}
                            type="button"
                            disabled={blocked || busy}
                            onClick={() =>
                              void move("apps/categories", group.category!.id, direction)
                            }
                            aria-label={`${group.category!.name} kategorisini ${
                              direction === -1 ? "yukarı" : "aşağı"
                            } taşı`}
                            className="rounded p-1 text-subtle transition-colors hover:text-ink disabled:opacity-25"
                          >
                            <Icon className="size-3.5" />
                          </button>
                        );
                      })}
                    </span>
                  )}
                </div>

                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {group.cards.map((card, index) => (
                    <AppTile
                      key={card.id}
                      card={card}
                      onEdit={canManage ? openEditApp : undefined}
                      widget={card.widgetType ? widgetStates[card.id] : undefined}
                      widgetActions={
                        widgets.find((widget) => widget.key === card.widgetType)?.actions ?? []
                      }
                      widgetBusy={widgetBusy === card.id}
                      onWidgetAction={canManage ? runWidgetAction : undefined}
                      move={
                        sorting
                          ? {
                              first: index === 0,
                              last: index === group.cards.length - 1,
                              onMove: (target, direction) =>
                                void move("apps", target.id, direction),
                            }
                          : undefined
                      }
                    />
                  ))}

                  {canManage && !query && !sorting && (
                    <button
                      type="button"
                      onClick={() => openNewApp(group.category?.id ?? null)}
                      className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-line p-3 text-sm text-subtle transition-colors hover:border-brand hover:text-ink"
                    >
                      <Plus className="size-4" /> Kart ekle
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {canManage && <BookmarkManager initialGroups={bookmarks} />}
      {canManageKiosk && <KioskManager initialTokens={kioskTokens} />}

      <Modal
        open={appModal.open}
        title={appModal.id === null ? "Kart ekle" : "Kartı düzenle"}
        onClose={() => setAppModal((modal) => ({ ...modal, open: false }))}
      >
        <div className="px-5 py-4">
          <AppForm
            values={appModal.values}
            categories={categories}
            monitors={monitors}
            containers={containers}
            widgets={widgets}
            widgetConfigured={appModal.widgetConfigured}
            busy={busy}
            error={formError}
            discovered={appModal.discovered}
            onChange={(patch) =>
              setAppModal((modal) => ({ ...modal, values: { ...modal.values, ...patch } }))
            }
            onSubmit={() => void saveApp()}
            onCancel={() => setAppModal((modal) => ({ ...modal, open: false }))}
            onDelete={appModal.id === null ? undefined : () => void removeApp()}
          />
        </div>
      </Modal>

      <Modal
        open={categoryModal.open}
        title={categoryModal.id === null ? "Kategori ekle" : "Kategoriyi düzenle"}
        onClose={() => setCategoryModal((modal) => ({ ...modal, open: false }))}
      >
        <form
          className="space-y-4 px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            void saveCategory();
          }}
        >
          <label className="block">
            <span className="text-xs font-medium">Ad</span>
            <input
              type="text"
              value={categoryModal.name}
              onChange={(e) => setCategoryModal((modal) => ({ ...modal, name: e.target.value }))}
              placeholder="Medya"
              autoFocus
              className="mt-1 w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand"
            />
          </label>

          <div>
            <span className="text-xs font-medium">İkon</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {Object.entries(CATEGORY_ICONS).map(([name, Icon]) => (
                <button
                  key={name}
                  type="button"
                  aria-label={name}
                  aria-pressed={categoryModal.icon === name}
                  onClick={() =>
                    setCategoryModal((modal) => ({
                      ...modal,
                      // Seçili ikona tekrar tıklamak seçimi kaldırır.
                      icon: modal.icon === name ? "" : name,
                    }))
                  }
                  className={`rounded-md border p-2 transition-colors ${
                    categoryModal.icon === name
                      ? "border-brand text-brand"
                      : "border-line text-subtle hover:text-ink"
                  }`}
                >
                  <Icon className="size-4" />
                </button>
              ))}
            </div>
          </div>

          {formError && <p className="text-sm text-danger">{formError}</p>}

          <div className="flex items-center justify-end gap-2">
            {categoryModal.id !== null && (
              <button
                type="button"
                onClick={() => void removeCategory()}
                disabled={busy}
                className="mr-auto flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:border-danger hover:text-danger disabled:opacity-50"
              >
                <Trash2 className="size-4" /> Sil
              </button>
            )}
            <button
              type="button"
              onClick={() => setCategoryModal((modal) => ({ ...modal, open: false }))}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:text-ink"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity disabled:opacity-50"
            >
              {busy ? "Kaydediliyor…" : "Kaydet"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
