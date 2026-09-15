import "server-only";

import { publishEvent } from "@/lib/integration/publish";
import { dispatch } from "@/lib/notify";
import { recordEvent } from "./store";
import type { Severity } from "./types";

/**
 * Tek seferlik bir olayı hem günlüğe yazar hem kanallara gönderir.
 *
 * Alarm motorundan (M1.3) AYRI: motor "bir koşul ne kadar süredir doğru,
 * tekrar bildirilmeli mi, susturulmuş mu" sorularını yönetiyor ve bunun için
 * kalıcı bir durum defteri tutuyor. Sertifikanın bitmesi, IP'nin değişmesi
 * ya da ağda yeni bir cihaz görülmesi ise koşul değil OLAY: bir kez olur,
 * tekrar etmez, susturulacak bir "sürüyor" hali yoktur.
 *
 * Motorun içine sokulsaydı her biri için sahte bir eşik ve sahte bir "ok"
 * durumu uydurmak gerekirdi.
 */
export async function announce(input: {
  alertKey: string;
  source: string;
  severity: Severity;
  title: string;
  detail: string;
}): Promise<{ notified: string[] }> {
  const result = await dispatch({
    severity: input.severity,
    title: input.title,
    detail: input.detail,
  });

  const failures = Object.entries(result.failed);
  const failureNote =
    failures.length > 0
      ? `\nGönderilemedi: ${failures.map(([key, value]) => `${key} (${value})`).join(", ")}`
      : "";

  const ts = Math.floor(Date.now() / 1000);

  recordEvent({
    ts,
    alertKey: input.alertKey,
    source: input.source,
    severity: input.severity,
    title: input.title,
    detail: input.detail + failureNote,
    notifiedChannels: result.sent,
    // Hiçbir kanala gitmediyse sebebi kaydediliyor; olay listesinde "neden
    // telefonuma düşmedi" sorusunun cevabı görünür olsun.
    suppressedReason: result.sent.length === 0 ? (result.skipped.join(",") || "kanal yok") : null,
  });

  // Olay kaydedildikten SONRA yayılıyor.
  //
  // Sıra önemli: MQTT broker'ı kapalıysa olay yine de günlükte durur. Tersi
  // sırada, ulaşılamayan bir broker yüzünden alarmın kaydı hiç yazılmayabilirdi.
  // Hata sessizce yutuluyor — bildirimin kendisi broker'a bağlı olmamalı.
  await publishEvent({
    severity: input.severity,
    source: input.source,
    alertKey: input.alertKey,
    title: input.title,
    detail: input.detail,
    ts,
  }).catch(() => {});

  return { notified: result.sent };
}
