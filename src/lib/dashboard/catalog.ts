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

export type WidgetDef = {
  key: string;
  label: string;
  description: string;
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
    label: "Saat ve hava durumu",
    description: "Yerel saat, tarih ve seçili konumun hava durumu.",
    visible: true,
    wide: false,
  },
  {
    key: "internet",
    label: "İnternet göstergesi",
    description: "Bağlantı durumu, genel IP ve son hız testi.",
    visible: true,
    wide: false,
  },
  {
    key: "quicklinks",
    label: "Hızlı erişim",
    description: "Arama kutusu, uygulama kısayolları ve yer imleri.",
    visible: true,
    wide: true,
  },
  {
    key: "apps",
    label: "Uygulama kartları",
    description: "Kategorilere ayrılmış uygulama ızgarası ve durum noktaları.",
    visible: true,
    wide: true,
  },
  {
    key: "maintenance",
    label: "Bakım",
    description: "Güncelleme, yedek ve bakım penceresi özeti.",
    permission: "panel.dashboard",
    visible: true,
    wide: true,
  },
  {
    key: "system",
    label: "Sistem bilgisi",
    description: "Sunucu adı, işletim sistemi, işlemci ve çalışma süresi.",
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
