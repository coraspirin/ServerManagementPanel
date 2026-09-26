import "server-only";
import { serverT } from "@/lib/i18n/runtime";

import { getDb } from "@/lib/db/client";
import { currentHostId, LOCAL_HOST_ID } from "@/lib/hosts/context";
import { isInMaintenance } from "@/lib/monitors/maintenance";
import { dispatch, hasUsableChannel } from "@/lib/notify";
import { runbookExcerpt } from "@/lib/docker/runbooks";
import { getBool, getNumber, getString } from "@/lib/settings";
import { evaluateConditionsAsync, type Condition } from "./conditions";
import { recordEvent } from "./store";
import { SEVERITY_ORDER, type Severity } from "./types";

/**
 * M1.3 — alarm durum makinesi.
 *
 * Dört ayrı korumayı tek yerde topluyor; hepsinin sebebi aynı: BİLDİRİM
 * GÜVENİLİR OLMALI. Yanlış alarm yağdıran bir sistem, kısa sürede susturulur ve
 * gerçek arıza da kaçar.
 *
 *   1. Flap koruması — bir durum `alerts.flap_threshold` tur üst üste aynı
 *      kalmadan bildirilmez. Sınırda gidip gelen değer telefon çaldırmaz.
 *   2. Dedup — aynı sorun `alerts.dedup_window` içinde tekrar bildirilmez.
 *      İstisna: seviye YÜKSELİYORSA ve "çözüldü" haberinde beklenmez.
 *   3. Bakım penceresi ve sessiz saatler — bildirim susar ama olay yine
 *      kaydedilir; "neden haber gelmedi" panelden görülebilir.
 *   4. Tırmandırma — çözülmeyen kritik alarm `alerts.escalate_after` sonra
 *      yeniden bildirilir, okundu işaretlenene kadar.
 */

type StateRow = {
  alert_key: string;
  severity: string;
  since: number;
  streak: number;
  last_notified_at: number | null;
  last_notified_severity: string | null;
  escalated_at: number | null;
  last_event_severity: string | null;
};

export type CycleSummary = {
  evaluated: number;
  notified: number;
  events: number;
  suppressed: Record<string, number>;
};

function parseTime(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Sessiz saat aralığı gece yarısını aşabilir (23:00–07:00). */
export function inQuietHours(at: Date): boolean {
  if (!getBool("alerts.quiet_hours.enabled")) return false;

  const start = parseTime(getString("alerts.quiet_hours.start"));
  const end = parseTime(getString("alerts.quiet_hours.end"));
  if (start === null || end === null || start === end) return false;

  const minute = at.getHours() * 60 + at.getMinutes();
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

/**
 * Bu alarmın son olayı okundu işaretlenmiş mi?
 *
 * Tırmandırma "hâlâ bozuk" demek için var; kullanıcı sorunu görüp okundu
 * işaretlediyse hatırlatmaya devam etmek sadece rahatsızlık olur.
 */
function isAcknowledged(alertKey: string): boolean {
  const row = getDb()
    .prepare(
      "SELECT acknowledged_at FROM events WHERE alert_key = ? ORDER BY ts DESC, id DESC LIMIT 1",
    )
    .get(alertKey) as { acknowledged_at: number | null } | undefined;
  return row?.acknowledged_at !== null && row?.acknowledged_at !== undefined;
}

function readState(key: string): StateRow | undefined {
  return getDb().prepare("SELECT * FROM alert_state WHERE alert_key = ?").get(key) as
    | StateRow
    | undefined;
}

function writeState(row: StateRow, now: number): void {
  getDb()
    .prepare(
      `INSERT INTO alert_state
         (alert_key, severity, since, streak, last_notified_at, last_notified_severity,
          escalated_at, last_event_severity, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(alert_key) DO UPDATE SET
         severity = excluded.severity,
         since = excluded.since,
         streak = excluded.streak,
         last_notified_at = excluded.last_notified_at,
         last_notified_severity = excluded.last_notified_severity,
         escalated_at = excluded.escalated_at,
         last_event_severity = excluded.last_event_severity,
         updated_at = excluded.updated_at`,
    )
    .run(
      row.alert_key,
      row.severity,
      row.since,
      row.streak,
      row.last_notified_at,
      row.last_notified_severity,
      row.escalated_at,
      row.last_event_severity,
      now,
    );
}

/**
 * Bildirim engellenmeli mi, engelleniyorsa neden?
 * Sıra önemli: en açıklayıcı sebep raporlanmalı ("bakım" > "sessiz saat").
 */
function suppressionReason(
  condition: Condition,
  state: StateRow | undefined,
  now: number,
  at: Date,
): string | null {
  if (isInMaintenance(condition.monitorId ?? null, at)) return "bakim";

  if (inQuietHours(at)) {
    const bypass =
      condition.severity === "critical" && getBool("alerts.quiet_hours.critical_bypass");
    if (!bypass) return "sessiz-saat";
  }

  // Dedup: seviye yükseliyorsa ya da sorun çözüldüyse beklemeye gerek yok —
  // ikisi de kullanıcının hemen bilmek istediği haberler.
  const window = getNumber("alerts.dedup_window") * 60;
  const previous = (state?.last_notified_severity ?? "ok") as Severity;
  const escalating = SEVERITY_ORDER[condition.severity] > SEVERITY_ORDER[previous];

  if (
    window > 0 &&
    !escalating &&
    condition.severity !== "ok" &&
    state?.last_notified_at !== null &&
    state?.last_notified_at !== undefined &&
    now - state.last_notified_at < window
  ) {
    return "dedup";
  }

  if (!hasUsableChannel(channelFilterSeverity(condition, state))) return "kanal-yok";

  return null;
}

/**
 * Kanal seviye filtresinde kullanılacak seviye.
 *
 * "Çözüldü" haberinin kendi seviyesi `ok`'tur ve hiçbir kanalın en düşük
 * seviyesini geçemez; olduğu gibi süzülürse kurtarma bildirimi HİÇ gitmez.
 * Oysa arızayı hangi kanala bildirdiysek düzeldiğini de oraya bildirmeliyiz —
 * bu yüzden süzme, önceki bildirimin seviyesine göre yapılır.
 */
function channelFilterSeverity(condition: Condition, state: StateRow | undefined): Severity {
  if (condition.severity !== "ok") return condition.severity;
  const previous = state?.last_notified_severity;
  return previous && previous !== "ok" ? (previous as Severity) : "warning";
}

export async function runAlertCycle(
  now: number = Math.floor(Date.now() / 1000),
): Promise<CycleSummary> {
  const at = new Date(now * 1000);
  // Uzak sunucunun anahtarları `h<id>:` önekli: iki sunucudaki aynı koşul
  // (`cpu`, `monitor:3`) durum defterinde ve olay listesinde karışmasın.
  // Yerel sunucu öneksiz — mevcut kayıtlar ve onaylar geçerli kalır.
  const hostId = currentHostId();
  const conditions = (await evaluateConditionsAsync()).map((condition) =>
    hostId === LOCAL_HOST_ID ? condition : { ...condition, key: `h${hostId}:${condition.key}` },
  );
  const flapThreshold = Math.max(1, getNumber("alerts.flap_threshold"));
  const escalateAfter = getNumber("alerts.escalate_after") * 60;

  const summary: CycleSummary = { evaluated: conditions.length, notified: 0, events: 0, suppressed: {} };

  for (const condition of conditions) {
    const previous = readState(condition.key);
    const continuing = previous !== undefined && previous.severity === condition.severity;

    const state: StateRow = {
      alert_key: condition.key,
      severity: condition.severity,
      since: continuing ? previous.since : now,
      streak: continuing ? previous.streak + 1 : 1,
      last_notified_at: previous?.last_notified_at ?? null,
      last_notified_severity: previous?.last_notified_severity ?? null,
      escalated_at: previous?.escalated_at ?? null,
      last_event_severity: previous?.last_event_severity ?? null,
    };

    // Flap koruması: eşik kadar tur aynı kalmadan hiçbir şey bildirilmez.
    if (state.streak < flapThreshold) {
      writeState(state, now);
      continue;
    }

    // İlk kez görülüp zaten sorunsuz olan bir koşul haber değil; yalnızca
    // başlangıç durumu olarak işaretlenir ki ilk arızada bildirim gitsin.
    //
    // `last_event_severity` de null olmalı: daha önce bu anahtar için bir arıza
    // günlüğe düştüyse (bildirim gitmemiş olsa bile) düzeldiğinin de günlükte
    // görünmesi gerekir. Aksi halde panelde "yanıt vermiyor" satırı asılı kalır
    // ve servisin geri geldiği hiçbir yerde yazmaz.
    if (
      state.last_notified_severity === null &&
      state.last_event_severity === null &&
      condition.severity === "ok"
    ) {
      state.last_notified_severity = "ok";
      state.last_event_severity = "ok";
      writeState(state, now);
      continue;
    }

    // İki ayrı defter var ve İKİSİ de tetiklemeli:
    //   - `last_notified_severity`: en son NE BİLDİRİLDİ
    //   - `last_event_severity`:    en son NE GÜNLÜĞE DÜŞTÜ
    //
    // Yalnızca ilkine bakmak sessiz bir arıza üretiyordu: kanal tanımlı
    // değilken bir servis düşerse olay günlüğe "kritik" olarak yazılır ama
    // hiçbir şey bildirilemediği için `last_notified_severity` "ok" kalır.
    // Servis geri geldiğinde `"ok" !== "ok"` yanlış çıkar, tur atlanır ve
    // düzeldiği HİÇBİR yere yazılmaz — panelde "yanıt vermiyor" satırı
    // asılı kalır. Bu, bildirim kanalı olmayan bir kurulumda alarm
    // ekranının kalıcı olarak yanlış olması demekti.
    const changed =
      state.last_notified_severity !== condition.severity ||
      state.last_event_severity !== condition.severity;
    const escalating =
      !changed &&
      condition.severity === "critical" &&
      escalateAfter > 0 &&
      state.last_notified_at !== null &&
      now - (state.escalated_at ?? state.last_notified_at) >= escalateAfter &&
      !isAcknowledged(condition.key);

    if (!changed && !escalating) {
      writeState(state, now);
      continue;
    }

    const result = await notifyFor(condition, state, now, at, escalating);
    if (result.notified) summary.notified++;
    if (result.event) summary.events++;
    if (result.reason) {
      summary.suppressed[result.reason] = (summary.suppressed[result.reason] ?? 0) + 1;
    }
    writeState(state, now);
  }

  // Kaynağı kalmayan anahtarları temizle (silinmiş monitör, ayrılmış disk).
  const activeKeys = conditions.map((c) => c.key);
  if (activeKeys.length > 0) {
    getDb()
      .prepare(
        `DELETE FROM alert_state WHERE alert_key NOT IN (${activeKeys.map(() => "?").join(",")})`,
      )
      .run(...activeKeys);
  }

  return summary;
}

/** Bildirimi dener, olayı kaydeder ve `state`i yerinde günceller. */
async function notifyFor(
  condition: Condition,
  state: StateRow,
  now: number,
  at: Date,
  escalation: boolean,
): Promise<{ notified: boolean; event: boolean; reason: string | null }> {
  const reason = suppressionReason(condition, state, now, at);
  const title = escalation
    ? serverT("alertsLib.ongoing", { title: condition.title })
    : condition.title;

  // Runbook notu YALNIZCA bildirime eklenir, olay kaydına değil: panelde
  // zaten container detayında duruyor ve olay listesini şişirmesi gereksiz.
  // "Düzeldi" haberine de eklenmez — çözülmüş bir sorunun müdahale adımları
  // kimsenin işine yaramaz (M1.8).
  const runbook =
    condition.container && condition.severity !== "ok"
      ? runbookExcerpt(condition.container)
      : null;
  const detail = runbook ? `${condition.detail}\n\n— Runbook —\n${runbook}` : condition.detail;

  let notifiedChannels: string[] = [];
  let failureNote = "";

  if (reason === null) {
    const result = await dispatch(
      { severity: condition.severity, title, detail },
      channelFilterSeverity(condition, state),
    );
    notifiedChannels = result.sent;

    const failures = Object.entries(result.failed);
    if (failures.length > 0) {
      failureNote = serverT("alertsLib.sendFailed", {
        list: failures.map(([k, v]) => `${k} (${v})`).join(", "),
      });
    }

    if (result.sent.length > 0) {
      state.last_notified_at = now;
      state.last_notified_severity = condition.severity;
      state.escalated_at = escalation ? now : null;
    }
  }

  // Çözülmüş bir koşul, bildirilemese bile "kapanmış" sayılır: sonradan
  // bildirilecek bir şey kalmadı. Aksi halde her turda yeniden denenir ve
  // kanal eklendiği gün geçmişteki bir düzelme haberi düşerdi.
  if (condition.severity === "ok" && state.last_notified_severity !== "ok") {
    state.last_notified_severity = "ok";
  }

  // Olay, ya seviye günlükte değiştiyse ya da gerçekten bildirim gittiyse yazılır.
  // Böylece bakım penceresi boyunca aynı olay her turda tekrarlanmaz ama pencere
  // kapanıp bildirim gidince kayda geçer.
  const severityChangedInLog = state.last_event_severity !== condition.severity;
  const shouldRecord = severityChangedInLog || notifiedChannels.length > 0 || escalation;

  if (shouldRecord) {
    recordEvent({
      ts: now,
      alertKey: condition.key,
      source: condition.source,
      severity: condition.severity,
      title,
      detail: condition.detail + failureNote,
      notifiedChannels,
      suppressedReason: reason ?? (notifiedChannels.length === 0 && !escalation ? "hata" : null),
    });
    state.last_event_severity = condition.severity;
  }

  return { notified: notifiedChannels.length > 0, event: shouldRecord, reason };
}
