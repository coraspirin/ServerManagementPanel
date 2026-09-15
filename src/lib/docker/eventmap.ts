/**
 * Docker olaylarının sınıflandırılması (M3.32).
 *
 * ## Neden gerekiyordu
 *
 * Docker'ın `/events` akışına hiç bağlanmıyorduk. `/events` EKRANIMIZ panelin
 * kendi alarmlarını gösteriyor; container'ın `start/stop/die/kill/oom`
 * olayları orada yoktu. En kritik eksik OOM'du: bir container bellek
 * yetmediği için öldürüldüğünde bunu hiçbir şekilde göremiyorduk. Yeniden
 * başlatma döngüsünü metrik farkından çıkarıyorduk (M1.6) — dolaylı,
 * gecikmeli ve OOM'u ayırt edemiyor.
 *
 * ## Asıl zorluk: hangi `die` haber değer
 *
 * `docker stop` da bir `die` üretiyor. Her `die`ı bildirim yapmak, panelin
 * kendi durdur düğmesinin bildirim göndermesi demek olurdu — kullanıcı zaten
 * o düğmeye basmışken.
 *
 * Ayrım ÇIKIŞ KODUNDA: `0` temiz çıkış, `143` SIGTERM (yani `docker stop`),
 * `137` SIGKILL. Üçü de kasıtlıdır ve sessizdir. `137`nin OOM hâli de var ama
 * Docker o durumda AYRICA bir `oom` olayı yolluyor — bildirim onun işi.
 *
 * I/O yok, `@/` yolu yok — `node --test` altında doğrudan çalışsın diye saf.
 */

import { notifiable } from "./labels.ts";

/** Kaydedilen container eylemleri; gerisi (image pull, network connect…) atlanıyor. */
export const TRACKED = new Set([
  "create",
  "start",
  "stop",
  "die",
  "kill",
  "restart",
  "pause",
  "unpause",
  "oom",
  "health_status",
]);

/**
 * Kasıtlı durdurmaların çıkış kodları.
 *
 * `0` temiz çıkış · `143` = 128+SIGTERM (`docker stop`'un ilk sinyali) ·
 * `137` = 128+SIGKILL (durdurma zaman aşımı ya da OOM; OOM'un kendi olayı var).
 */
const SESSIZ_CIKIS = new Set([0, 143, 137]);

export type DockerEventRaw = {
  Type?: string;
  Action?: string;
  status?: string;
  time?: number;
  Actor?: { ID?: string; Attributes?: Record<string, string> };
};

export type ClassifiedEvent = {
  /** Normalleştirilmiş eylem: `health_status: unhealthy` → `health_status`. */
  action: string;
  containerId: string;
  containerName: string;
  image: string;
  composeProject: string;
  ts: number;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  alertKey: string;
  /** Bildirim kanallarına gitsin mi. Kayda her hâlükârda yazılıyor. */
  notify: boolean;
  /** `die` olayında çıkış kodu; diğerlerinde null. */
  exitCode: number | null;
};

const BASLIK: Record<string, string> = {
  create: "oluşturuldu",
  start: "başlatıldı",
  stop: "durduruldu",
  die: "sonlandı",
  kill: "öldürüldü",
  restart: "yeniden başlatıldı",
  pause: "duraklatıldı",
  unpause: "sürdürüldü",
  oom: "BELLEK YETMEDİ (OOM)",
  health_status: "sağlık durumu değişti",
};

/**
 * Ham Docker olayını panelin olay kaydına çevirir; ilgilenmediğimiz olaylarda
 * `null`.
 */
export function classify(raw: DockerEventRaw): ClassifiedEvent | null {
  if (raw.Type !== "container") return null;

  const ham = String(raw.Action ?? raw.status ?? "");
  if (!ham) return null;

  // `health_status: healthy` biçimi — iki nokta öncesi eylem, sonrası durum.
  const [actionRaw, durumRaw = ""] = ham.split(":");
  const action = actionRaw.trim();
  const durum = durumRaw.trim();

  if (!TRACKED.has(action)) return null;

  const attrs = raw.Actor?.Attributes ?? {};
  const containerName = attrs.name ?? "";
  const containerId = raw.Actor?.ID ?? "";
  const image = attrs.image ?? "";
  const composeProject = attrs["com.docker.compose.project"] ?? "";

  const exitRaw = attrs.exitCode;
  const exitCode =
    action === "die" && exitRaw !== undefined && /^-?\d+$/.test(exitRaw)
      ? Number.parseInt(exitRaw, 10)
      : null;

  let severity: ClassifiedEvent["severity"] = "info";
  let notify = false;

  if (action === "oom") {
    severity = "critical";
    notify = true;
  } else if (action === "die" && exitCode !== null && !SESSIZ_CIKIS.has(exitCode)) {
    severity = "warning";
    notify = true;
  } else if (action === "health_status" && durum === "unhealthy") {
    // Sağlık düşüşü kayda "uyarı" olarak giriyor ama BİLDİRİM ÜRETMİYOR:
    // container monitörleri (M1.2) zaten aynı durumu izliyor ve alarm
    // motorunun eşik/tekrar/susturma mantığı orada. İkisinin birden
    // bildirmesi aynı arızayı iki kez telefona düşürürdü.
    severity = "warning";
  }

  /*
    `panel.notify=false` etiketi bildirimi kapatıyor, KAYDI değil. Etiket
    olayları duyulmasın diye var, olmasınlar diye değil — sonradan "ne oldu"
    diye bakan biri yine görebilmeli.

    Etiketler olayın kendi içinde geliyor (Actor.Attributes), yani container
    ölmüş olsa bile okunabiliyor; ek bir inspect çağrısı gerekmiyor.
  */
  if (!notifiable(attrs)) notify = false;

  const ad = containerName || containerId.slice(0, 12) || "container";
  const baslik = `${ad} ${BASLIK[action] ?? action}${durum ? `: ${durum}` : ""}`;

  const parcalar: string[] = [];
  if (image) parcalar.push(`imaj: ${image}`);
  if (composeProject) parcalar.push(`yığın: ${composeProject}`);
  if (exitCode !== null) parcalar.push(`çıkış kodu: ${exitCode}`);
  if (action === "oom") {
    parcalar.push(
      "Container'a ayrılan bellek sınırı aşıldı ve çekirdek onu öldürdü. " +
        "Sınırı yükseltmek ya da uygulamanın bellek kullanımını düşürmek gerekiyor.",
    );
  }

  return {
    action,
    containerId,
    containerName: ad,
    image,
    composeProject,
    ts: raw.time ?? Math.floor(Date.now() / 1000),
    severity,
    title: baslik,
    detail: parcalar.join(" · "),
    // Olay listesindeki gruplama anahtarı: container + eylem. Aynı
    // container'ın aynı olayı tek bir dizide toplansın.
    alertKey: `docker.${action}.${ad}`,
    notify,
    exitCode,
  };
}
