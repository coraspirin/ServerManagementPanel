import type { PermissionKey } from "@/lib/auth/types";

/**
 * M3.13 — gösterge paneli widget katalogu.
 *
 * `server-only` YOK: düzenleme arayüzü (istemci) etiketleri buradan okuyor.
 *
 * Sıra ve görünürlük varsayılanları burada; kullanıcı sapması veritabanında.
 * Yeni bir widget eklemek buraya bir satır yazmaktır — kayıtlı kullanıcıların
 * satırlarını güncellemek gerekmez, widget kendiliğinden listenin sonunda
 * belirir (bkz. migration 020).
 */

/** Ad ve açıklama dil dosyasında: `dashboard.widget.<key>.label` / `.description`. */
export type WidgetDef = {
  key: string;
  /** Gerekiyorsa: bu yetki yoksa widget hiç sunulmaz. */
  permission?: PermissionKey;
  /** Varsayılan olarak açık mı. */
  visible: boolean;
  /**
   * Tam genişlik mi kaplıyor — ızgara yerleşimi için.
   * Sürükle-bırak sıralaması tek sütunlu bir listedir; iki boyutlu bir ızgara
   * düzenleyicisi, kazanacağı şeyin yanında fazla karmaşık olurdu.
   */
  wide: boolean;
};

export const WIDGETS: WidgetDef[] = [
  {
    key: "clock",
    visible: true,
    wide: false,
  },
  {
    key: "internet",
    visible: true,
    wide: false,
  },
  {
    key: "quicklinks",
    visible: true,
    wide: true,
  },
  {
    key: "apps",
    visible: true,
    wide: true,
  },
  {
    key: "maintenance",
    permission: "panel.dashboard",
    visible: true,
    wide: true,
  },
  {
    key: "system",
    permission: "panel.dashboard",
    visible: true,
    wide: true,
  },
];

const BY_KEY = new Map(WIDGETS.map((widget) => [widget.key, widget]));

export function findWidget(key: string): WidgetDef | undefined {
  return BY_KEY.get(key);
}

export type WidgetPlacement = {
  key: string;
  label: string;
  description: string;
  visible: boolean;
  wide: boolean;
};
