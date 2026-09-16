/**
 * Cron ifadelerini insan diline çeviren ve basit kalıplardan üreten yardımcılar.
 *
 * Cron depolama biçimi olarak korunuyor (esnek ve standart), ama kullanıcıya
 * hiçbir zaman ham "17 * * * *" gösterilmiyor: arayüz sıklık seçicisiyle
 * çalışır, bu modül iki yön arasında çeviri yapar.
 *
 * Tarayıcıda da çalışması gerektiği için bağımlılık kullanmıyor.
 */

import { formatMonth, formatWeekday } from "../i18n/format.ts";
import type { Dictionary } from "../i18n/locales.ts";
import type { TFunction } from "../i18n/translate.ts";

export type CronMode =
  | "minutes"
  | "hourly"
  | "daily"
  /** "15 günde bir saat 03:00" — gün alanında `*​/N`. */
  | "days"
  | "weekly"
  | "monthly"
  | "yearly"
  | "custom";

export type CronParts = {
  mode: CronMode;
  /** dakika (0-59) */
  minute: number;
  /** saat (0-23) */
  hour: number;
  /** haftanın günü (0=Pazar) */
  weekday: number;
  /** ayın günü (1-31) */
  monthday: number;
  /** ay (1-12) — yalnızca "yearly" modunda anlamlı */
  month: number;
  /** "minutes" modunda kaç dakikada bir */
  everyMinutes: number;
  /** "days" modunda kaç günde bir */
  everyDays: number;
  /** "custom" modunda ham ifade */
  raw: string;
};

const DEFAULT_PARTS: CronParts = {
  mode: "daily",
  minute: 0,
  hour: 3,
  weekday: 1,
  monthday: 1,
  month: 1,
  everyMinutes: 5,
  everyDays: 15,
  raw: "0 3 * * *",
};

export function parseCron(expression: string): CronParts {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return { ...DEFAULT_PARTS, mode: "custom", raw: expression };

  const [min, hour, dom, month, dow] = fields;
  const base = { ...DEFAULT_PARTS, raw: expression };

  const isNum = (s: string) => /^\d+$/.test(s);

  const everyHour = hour === "*" && dom === "*" && month === "*" && dow === "*";

  // * * * * *  → her dakika
  if (min === "*" && everyHour) {
    return { ...base, mode: "minutes", everyMinutes: 1 };
  }

  // */N * * * *  → her N dakikada bir
  if (/^\*\/\d+$/.test(min) && everyHour) {
    return { ...base, mode: "minutes", everyMinutes: Number(min.slice(2)) };
  }

  // M * * * *  → her saat, M. dakikada
  if (isNum(min) && hour === "*" && dom === "*" && month === "*" && dow === "*") {
    return { ...base, mode: "hourly", minute: Number(min) };
  }

  // M H * * *  → her gün
  if (isNum(min) && isNum(hour) && dom === "*" && month === "*" && dow === "*") {
    return { ...base, mode: "daily", minute: Number(min), hour: Number(hour) };
  }

  // M H */N * *  → N günde bir
  if (isNum(min) && isNum(hour) && /^\*\/\d+$/.test(dom) && month === "*" && dow === "*") {
    return {
      ...base,
      mode: "days",
      minute: Number(min),
      hour: Number(hour),
      everyDays: Number(dom.slice(2)),
    };
  }

  // M H D Mo *  → yılda bir
  if (isNum(min) && isNum(hour) && isNum(dom) && isNum(month) && dow === "*") {
    return {
      ...base,
      mode: "yearly",
      minute: Number(min),
      hour: Number(hour),
      monthday: Number(dom),
      month: Number(month),
    };
  }

  // M H * * D  → haftada bir
  if (isNum(min) && isNum(hour) && dom === "*" && month === "*" && isNum(dow)) {
    return {
      ...base,
      mode: "weekly",
      minute: Number(min),
      hour: Number(hour),
      weekday: Number(dow),
    };
  }

  // M H D * *  → ayda bir
  if (isNum(min) && isNum(hour) && isNum(dom) && month === "*" && dow === "*") {
    return {
      ...base,
      mode: "monthly",
      minute: Number(min),
      hour: Number(hour),
      monthday: Number(dom),
    };
  }

  return { ...base, mode: "custom" };
}

export function buildCron(parts: CronParts): string {
  const pad = (n: number) => String(n);
  switch (parts.mode) {
    case "minutes":
      // Her dakika için "* * * * *" daha okunur ve standarttır.
      return parts.everyMinutes === 1 ? "* * * * *" : `*/${pad(parts.everyMinutes)} * * * *`;
    case "hourly":
      return `${pad(parts.minute)} * * * *`;
    case "daily":
      return `${pad(parts.minute)} ${pad(parts.hour)} * * *`;
    case "days":
      // "1 günde bir" = her gün; `*/1` teknik olarak doğru ama okunmuyor.
      return parts.everyDays === 1
        ? `${pad(parts.minute)} ${pad(parts.hour)} * * *`
        : `${pad(parts.minute)} ${pad(parts.hour)} */${pad(parts.everyDays)} * *`;
    case "yearly":
      return `${pad(parts.minute)} ${pad(parts.hour)} ${pad(parts.monthday)} ${pad(parts.month)} *`;
    case "weekly":
      return `${pad(parts.minute)} ${pad(parts.hour)} * * ${pad(parts.weekday)}`;
    case "monthly":
      return `${pad(parts.minute)} ${pad(parts.hour)} ${pad(parts.monthday)} * *`;
    default:
      return parts.raw;
  }
}

function hhmm(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** "Her gün saat 04:23'te" gibi bir cümle üretir. */
export function describeCron(expression: string, t: TFunction, dict: Dictionary): string {
  const parts = parseCron(expression);
  const time = hhmm(parts.hour, parts.minute);

  switch (parts.mode) {
    case "minutes":
      return parts.everyMinutes === 1
        ? t("cron.describe.everyMinute")
        : t("cron.describe.everyMinutes", { count: parts.everyMinutes });
    case "hourly":
      return parts.minute === 0
        ? t("cron.describe.hourTop")
        : t("cron.describe.hourly", { minute: parts.minute });
    case "daily":
      return t("cron.describe.daily", { time });
    case "days":
      return t("cron.describe.days", { count: parts.everyDays, time });
    case "yearly":
      return t("cron.describe.yearly", {
        month: formatMonth(parts.month, dict),
        day: parts.monthday,
        time,
      });
    case "weekly":
      return t("cron.describe.weekly", { weekday: formatWeekday(parts.weekday, dict), time });
    case "monthly":
      return t("cron.describe.monthly", { day: parts.monthday, time });
    default:
      return t("cron.describe.custom");
  }
}

// --- Sonraki çalışma önizlemesi -------------------------------------------

/** Tek bir cron alanının verilen değerle eşleşip eşleşmediği. */
function fieldMatches(value: number, field: string): boolean {
  for (const part of field.split(",")) {
    if (part === "*") return true;

    const [range, stepText] = part.split("/");
    const step = stepText ? Number(stepText) : 1;
    if (!Number.isFinite(step) || step <= 0) continue;

    if (range === "*") {
      if (value % step === 0) return true;
      continue;
    }

    if (range.includes("-")) {
      const [from, to] = range.split("-").map(Number);
      if (
        Number.isFinite(from) &&
        Number.isFinite(to) &&
        value >= from &&
        value <= to &&
        (value - from) % step === 0
      ) {
        return true;
      }
      continue;
    }

    const exact = Number(range);
    if (Number.isFinite(exact)) {
      if (step === 1 ? value === exact : value >= exact && (value - exact) % step === 0) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Sonraki N çalışma anı. Dakika dakika ilerleyerek eşleşme arar; en fazla
 * 400 gün taranır (yılda bir çalışan ifadeler için yeterli, sonsuz döngü yok).
 */
export function nextRuns(expression: string, count = 3, from: Date = new Date()): Date[] {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return [];

  const [min, hour, dom, month, dow] = fields;
  const results: Date[] = [];

  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  const limit = 400 * 24 * 60;
  for (let i = 0; i < limit && results.length < count; i++) {
    if (
      fieldMatches(cursor.getMinutes(), min) &&
      fieldMatches(cursor.getHours(), hour) &&
      fieldMatches(cursor.getDate(), dom) &&
      fieldMatches(cursor.getMonth() + 1, month) &&
      fieldMatches(cursor.getDay(), dow)
    ) {
      results.push(new Date(cursor.getTime()));
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  return results;
}
