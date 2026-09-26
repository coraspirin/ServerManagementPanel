/**
 * M1.2 — servis izleme paylaşılan tipleri.
 *
 * `server-only` YOK: hem job runner hem de Servis Durumu ekranı kullanır.
 */

export type MonitorType = "http" | "tcp" | "ping" | "dns" | "container";
export type MonitorStatus = "up" | "down" | "bilinmiyor";

/**
 * Metinler dil dosyasında: `monitorType.<value>.label` / `.hint` / `.expected`
 * (`expected` alanının tipe göre anlamı — arayüzde yardım metni).
 */
export const MONITOR_TYPES: { value: MonitorType }[] = [
  { value: "http" },
  { value: "tcp" },
  { value: "ping" },
  { value: "dns" },
  { value: "container" },
];

export type Monitor = {
  id: number;
  /** Monitörün ait olduğu sunucu — Servis Durumu ekranı seçili sunucuya göre süzer. */
  hostId: number;
  name: string;
  type: MonitorType;
  target: string;
  expected: string;
  enabled: boolean;
  ignoreTls: boolean;
  /** null = ayarlardaki global değer (T9 ezme). */
  intervalSeconds: number | null;
  timeoutSeconds: number | null;
  retries: number | null;
  downThreshold: number | null;
  status: MonitorStatus;
  consecutiveFails: number;
  consecutiveOk: number;
  lastCheckAt: number | null;
  lastChangeAt: number | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  nextCheckAt: number | null;
  sortOrder: number;
};

/** Çözümlenmiş ayarlarla birlikte — arayüz "varsayılan (60 sn)" yazabilsin diye. */
export type MonitorEffective = {
  intervalSeconds: number;
  timeoutSeconds: number;
  retries: number;
  downThreshold: number;
};

export type UptimeDay = {
  /** YYYY-MM-DD */
  date: string;
  /** Kullanılabilirlik yüzdesi; o gün hiç veri yoksa null. */
  upPct: number | null;
  downSeconds: number;
  maintenanceSeconds: number;
};

export type MonitorView = Monitor & {
  effective: MonitorEffective;
  uptime24h: number | null;
  uptime30d: number | null;
  /** En yeni gün sonda olacak şekilde sıralı. */
  days: UptimeDay[];
  inMaintenance: boolean;
};

export type MaintenanceKind = "once" | "weekly";

export type MaintenanceWindow = {
  id: number;
  name: string;
  kind: MaintenanceKind;
  startsAt: number | null;
  endsAt: number | null;
  /** 0 = Pazar. */
  weekdays: number[];
  /** Gün içi dakika (0-1439). */
  startMinute: number | null;
  endMinute: number | null;
  /** null = tüm monitörler. */
  monitorId: number | null;
  enabled: boolean;
  /** Şu an aktif mi (sunucuda hesaplanır). */
  active: boolean;
};
