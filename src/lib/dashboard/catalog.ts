import type { PermissionKey } from "@/lib/auth/types";

/**
 * M3.13 — gösterge paneli widget katalogu.
 *
 * `server-only` YOK: düzenleme arayüzü (istemci) etiketleri buradan okuyor.
 *
 * Sıra, görünürlük ve boyut varsayılanları burada; kullanıcı sapması
 * veritabanında. Yeni bir widget eklemek buraya bir satır yazmaktır — kayıtlı
 * kullanıcıların satırlarını güncellemek gerekmez, widget kendiliğinden
 * listenin sonunda belirir (bkz. migration 020).
 */

/**
 * Widget genişliği — 12 sütunlu ızgarada geniş ekranda 3/4/6/12 sütun.
 *
 * Dar ekranda hepsi tam genişlik, orta ekranda sm/md yarım genişliğe iner.
 * Kullanıcı yalnızca bu dört kalıptan birini seçer; serbest sütun sayısı
 * düzenleyiciyi iki boyutlu bir ızgara editörüne çevirirdi.
 */
export type WidgetSize = "sm" | "md" | "lg" | "full";

export const WIDGET_SIZES: readonly WidgetSize[] = ["sm", "md", "lg", "full"];

export function isWidgetSize(value: unknown): value is WidgetSize {
  return typeof value === "string" && (WIDGET_SIZES as readonly string[]).includes(value);
}

/** Ad ve açıklama dil dosyasında: `dashboard.widget.<key>.label` / `.description`. */
export type WidgetDef = {
  key: string;
  /** Gerekiyorsa: bu yetki yoksa widget hiç sunulmaz. */
  permission?: PermissionKey;
  /** Varsayılan olarak açık mı. */
  visible: boolean;
  /** Varsayılan genişlik. */
  size: WidgetSize;
};

/*
  Varsayılan sıra "dengeli": üstte sağlık özeti ve günlük bilgiler, ortada
  kaynaklar ve olaylar, altta uygulamalar ve bakım. Ev halkının da kullandığı
  uygulama kartları varsayılanda açık kalıyor.
*/
export const WIDGETS: WidgetDef[] = [
  { key: "status", permission: "metrics.view", visible: true, size: "full" },
  { key: "clock", visible: true, size: "md" },
  { key: "internet", visible: true, size: "md" },
  { key: "system", permission: "panel.dashboard", visible: true, size: "md" },
  { key: "resources", permission: "metrics.view", visible: true, size: "full" },
  { key: "fleet", permission: "hosts.view", visible: true, size: "full" },
  { key: "events", permission: "metrics.view", visible: true, size: "lg" },
  { key: "uptime", permission: "metrics.view", visible: true, size: "lg" },
  { key: "quicklinks", visible: true, size: "full" },
  { key: "apps", visible: true, size: "full" },
  { key: "containers", permission: "docker.view", visible: true, size: "lg" },
  { key: "backups", permission: "backup.manage", visible: true, size: "lg" },
  { key: "maintenance", permission: "panel.dashboard", visible: true, size: "full" },
];

const BY_KEY = new Map(WIDGETS.map((widget) => [widget.key, widget]));

export function findWidget(key: string): WidgetDef | undefined {
  return BY_KEY.get(key);
}

/**
 * Kaynak kartlarının grafik metrikleri. İstemci bileşeninde değil burada:
 * `"use client"` modülünden sunucuya aktarılan bir değer dizi değil istemci
 * referansı olarak gelir ve sunucudaki ilk sorgu boş kalırdı.
 */
export const RESOURCE_METRICS = ["cpu.pct", "mem.used_pct", "disk.used_pct", "net.rx_bps", "net.tx_bps"];

export type WidgetPlacement = {
  key: string;
  label: string;
  description: string;
  visible: boolean;
  size: WidgetSize;
};
