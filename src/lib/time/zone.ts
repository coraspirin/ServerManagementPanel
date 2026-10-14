/**
 * Panelin saat dilimi — TEK KAYNAK `general.timezone` ayarı.
 *
 * Saf modül (istemci ve testler de import ediyor). Sunucu tarafında ayar
 * `process.env.TZ`'ye yazılıyor: Node bunu çalışma anında uyguluyor, böylece
 * cron hesapları, `getHours()` kullanan bakım pencereleri, gün kovaları ve
 * dosya adı damgaları ek bir değişiklik gerektirmeden aynı saate bakıyor.
 * İstemci aynı değeri kök layout'tan alıp her tarih biçimlemesine veriyor —
 * tarayıcının kendi saat dilimi KULLANILMIYOR.
 *
 * Sebep (2026-10-14): container'da `TZ` boştu, süreç UTC çalışıyordu; yedek
 * "0 6 * * *" sunucuda 06:00 UTC'de (TR 09:00) çalışırken cron önizlemesi
 * tarayıcı saatiyle 06:00 gösteriyordu.
 */

export const TIMEZONE_SETTING = "general.timezone";

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Seçici listesi: çalışma ortamının bildiği bütün IANA adları + UTC. */
export function supportedTimeZones(): string[] {
  const list = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return list.includes("UTC") ? list : ["UTC", ...list];
}

/** Sunucu süreci: geçerliyse `process.env.TZ`'ye yazar, değilse dokunmaz. */
export function applyProcessTimeZone(value: unknown): boolean {
  if (!isValidTimeZone(value)) return false;
  process.env.TZ = value;
  return true;
}

/**
 * Bir anın verilen saat dilimindeki duvar saati, UTC alanlarına yazılmış
 * hâlde (`getUTCHours()` = o dilimdeki saat). Cron eşleştirmesi bu sayede
 * tarayıcının diliminden bağımsız.
 */
export function wallClock(instant: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return new Date(
    Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")),
  );
}

/**
 * `wallClock`'un tersi: o dilimdeki duvar saatine karşılık gelen gerçek an.
 *
 * Yaz saati sınırı iki uç durum doğurur, ikisi de sunucudaki `cron-parser`
 * ile aynı çözülüyor (testte karşılaştırılıyor):
 *  - Geri alış (02:30 iki kez yaşanır): ÖNCEKİ an seçilir.
 *  - İleri alış (02:30 hiç yaşanmaz): sınırdan önceki farkla hesaplanır,
 *    yani boşluğun hemen sonrasına düşer.
 */
export function fromWallClock(wall: Date, timeZone: string): Date {
  const target = wall.getTime();
  const offsetAt = (instant: number) => wallClock(new Date(instant), timeZone).getTime() - instant;
  const day = 86_400_000;
  const candidates = [offsetAt(target - day), offsetAt(target), offsetAt(target + day)]
    .map((offset) => target - offset)
    .filter((instant) => wallClock(new Date(instant), timeZone).getTime() === target)
    .sort((a, b) => a - b);
  return new Date(candidates[0] ?? target - offsetAt(target - day));
}
