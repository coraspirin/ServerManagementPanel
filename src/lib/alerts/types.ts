/**
 * M1.3 — alarm ve olay paylaşılan tipleri (istemci de kullanır).
 */

export type Severity = "ok" | "info" | "warning" | "critical";

export const SEVERITY_ORDER: Record<Severity, number> = {
  ok: 0,
  info: 1,
  warning: 2,
  critical: 3,
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  ok: "çözüldü",
  info: "bilgi",
  warning: "uyarı",
  critical: "kritik",
};

/** Bildirimin neden gönderilmediği — "neden haber gelmedi?" sorusunun cevabı. */
export const SUPPRESS_LABEL: Record<string, string> = {
  bakim: "bakım penceresi",
  "sessiz-saat": "sessiz saatler",
  dedup: "yakın zamanda bildirildi",
  flap: "henüz doğrulanmadı",
  "kanal-yok": "uygun kanal yok",
  seviye: "kanal seviye filtresi",
  hata: "gönderim hatası",
  // M3.32 — Docker'ın rutin yaşam döngüsü olayları. Baskılanmadılar; zaten
  // bildirilecek türden değiller ve kullanıcı bunu ayırt edebilmeli.
  rutin: "rutin olay, bildirim gerekmiyor",
};

export type EventRow = {
  id: number;
  ts: number;
  alertKey: string;
  source: string;
  severity: Severity;
  title: string;
  detail: string;
  notifiedChannels: string[];
  suppressedReason: string | null;
  acknowledgedAt: number | null;
  acknowledgedBy: string | null;
};

export type ChannelStatus = {
  key: string;
  label: string;
  enabled: boolean;
  /** Ayarları eksikse neyin eksik olduğu. */
  problem: string | null;
  minLevel: Severity;
};

export function isSeverity(value: string): value is Severity {
  return value in SEVERITY_ORDER;
}
