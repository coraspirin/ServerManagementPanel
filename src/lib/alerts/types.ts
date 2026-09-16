/**
 * M1.3 — alarm ve olay paylaşılan tipleri (istemci de kullanır).
 */

import type { MessageKey } from "../i18n/translate.ts";

export type Severity = "ok" | "info" | "warning" | "critical";

export const SEVERITY_ORDER: Record<Severity, number> = {
  ok: 0,
  info: 1,
  warning: 2,
  critical: 3,
};

export const SEVERITY_LABEL: Record<Severity, MessageKey> = {
  ok: "alerts.severity.ok",
  info: "alerts.severity.info",
  warning: "alerts.severity.warning",
  critical: "alerts.severity.critical",
};

/** Bildirimin neden gönderilmediği — "neden haber gelmedi?" sorusunun cevabı. */
export const SUPPRESS_LABEL: Record<string, MessageKey> = {
  bakim: "alerts.suppress.bakim",
  "sessiz-saat": "alerts.suppress.sessiz-saat",
  dedup: "alerts.suppress.dedup",
  flap: "alerts.suppress.flap",
  "kanal-yok": "alerts.suppress.kanal-yok",
  seviye: "alerts.suppress.seviye",
  hata: "alerts.suppress.hata",
  // M3.32 — Docker'ın rutin yaşam döngüsü olayları. Baskılanmadılar; zaten
  // bildirilecek türden değiller ve kullanıcı bunu ayırt edebilmeli.
  rutin: "alerts.suppress.rutin",
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
