export type LogLevel = "debug" | "info" | "warning" | "error";
export type LogKind = "container" | "journald";

export type LogRecord = {
  id: number;
  ts: number;
  source: string;
  kind: LogKind;
  stream: string;
  level: LogLevel;
  message: string;
};

export type LogSearch = {
  /** FTS5 sorgusu ya da düz metin — store içinde güvenli biçime çevrilir. */
  q?: string;
  sources?: string[];
  levels?: LogLevel[];
  kind?: LogKind;
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
};

export type LogSourceInfo = {
  source: string;
  kind: LogKind;
  lines: number;
  oldest: number;
  newest: number;
  lastRunAt: number | null;
  lastCount: number;
  lastError: string;
};

export type LogSearchResult = {
  records: LogRecord[];
  total: number;
  sources: LogSourceInfo[];
  /** Toplam satır ve kapladığı yer — saklama politikasını ayarlamak için. */
  totalLines: number;
  oldest: number | null;
};

export type LogPattern = {
  id: number;
  name: string;
  pattern: string;
  isRegex: boolean;
  sourceFilter: string;
  severity: "info" | "warning" | "critical";
  enabled: boolean;
  cooldownMinutes: number;
  lastHitAt: number | null;
  hitCount: number;
};

export const LEVEL_LABEL: Record<LogLevel, string> = {
  debug: "ayıklama",
  info: "bilgi",
  warning: "uyarı",
  error: "hata",
};
