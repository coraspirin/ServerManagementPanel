/**
 * M1.2 — servis izleme paylaşılan tipleri.
 *
 * `server-only` YOK: hem job runner hem de Servis Durumu ekranı kullanır.
 */

export type MonitorType = "http" | "tcp" | "ping" | "dns" | "container";
export type MonitorStatus = "up" | "down" | "bilinmiyor";

export const MONITOR_TYPES: { value: MonitorType; label: string; hint: string }[] = [
  {
    value: "http",
    label: "HTTP(S)",
    hint: "Tam adres: https://192.168.61.114:8123 veya http://sunucu/health",
  },
  { value: "tcp", label: "TCP portu", hint: "sunucu:port — ör. 192.168.61.114:1883" },
  { value: "ping", label: "Ping (ICMP)", hint: "IP ya da makine adı — ör. 192.168.61.1" },
  { value: "dns", label: "DNS çözümleme", hint: "Alan adı — ör. google.com" },
  { value: "container", label: "Docker container", hint: "Container adı — ör. homeassistant" },
];

/** `expected` alanının tipe göre anlamı — arayüzde yardım metni olarak gösterilir. */
export const EXPECTED_HINTS: Record<MonitorType, string> = {
  http: "Boş: 400'ün altındaki her durum kodu başarılı. '200' ya da '200,204': tam eşleşme. 'metin:hazır': gövde bu metni içermeli.",
  tcp: "Kullanılmıyor — bağlantı kurulabiliyorsa başarılı.",
  ping: "Kullanılmıyor — yanıt geliyorsa başarılı.",
  dns: "Boş: herhangi bir kayıt yeterli. Değer verilirse çözümlenen kayıtlardan biri bunu içermeli.",
  container: "Boş: container çalışıyor olmalı. 'healthy': Docker sağlık kontrolü de geçmeli.",
};

export type Monitor = {
  id: number;
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
