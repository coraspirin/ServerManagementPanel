import "server-only";

import { SEVERITY_ORDER, isSeverity, type ChannelStatus, type Severity } from "@/lib/alerts/types";
import { getBool, getString } from "@/lib/settings";
import { findChannel, notifyChannels } from "./channels";
import type { NotifyMessage } from "./types";

export type DispatchResult = {
  /** Gerçekten gönderim yapılan kanallar. */
  sent: string[];
  /** Kanal → hata mesajı. */
  failed: Record<string, string>;
  /** Seviye filtresi ya da eksik ayar yüzünden atlananlar. */
  skipped: string[];
};

function minLevelOf(key: string): Severity {
  const value = getString(`notify.${key}.min_level`);
  return isSeverity(value) ? value : "warning";
}

export function channelStatuses(): ChannelStatus[] {
  return notifyChannels.map((channel) => ({
    key: channel.key,
    label: channel.label,
    enabled: getBool(`notify.${channel.key}.enabled`),
    problem: channel.problem(),
    minLevel: minLevelOf(channel.key),
  }));
}

/**
 * Etkin ve ayarları tam olan kanal var mı — bastırma sebebini ayırt etmek için.
 *
 * `filterSeverity` mesajın kendi seviyesinden AYRI verilebilir. Sebebi:
 * "çözüldü" haberinin seviyesi `ok`'tur ve her kanalın en düşük seviyesinin
 * altında kalır — yani hiçbir kurtarma bildirimi gönderilemezdi. Oysa bir
 * arızayı haber verdiğimiz kanal, düzeldiğini de haber vermeli. Bu yüzden
 * kurtarma mesajları ARIZANIN seviyesine göre süzülür.
 */
export function hasUsableChannel(severity: Severity): boolean {
  return channelStatuses().some(
    (status) =>
      status.enabled &&
      status.problem === null &&
      SEVERITY_ORDER[severity] >= SEVERITY_ORDER[status.minLevel],
  );
}

/**
 * Mesajı uygun tüm kanallara gönderir.
 *
 * Kanallar PARALEL denenir ve biri patlarsa diğerleri etkilenmez: Telegram
 * erişilemez diye e-posta da gitmesin diye bir sebep yok. Hatalar yutulmaz,
 * `failed` içinde döner ve olay kaydına yazılır.
 */
export async function dispatch(
  message: NotifyMessage,
  filterSeverity: Severity = message.severity,
): Promise<DispatchResult> {
  const result: DispatchResult = { sent: [], failed: {}, skipped: [] };

  const targets = notifyChannels.filter((channel) => {
    if (!getBool(`notify.${channel.key}.enabled`)) return false;
    if (SEVERITY_ORDER[filterSeverity] < SEVERITY_ORDER[minLevelOf(channel.key)]) {
      result.skipped.push(channel.key);
      return false;
    }
    const problem = channel.problem();
    if (problem) {
      result.failed[channel.key] = problem;
      return false;
    }
    return true;
  });

  await Promise.all(
    targets.map(async (channel) => {
      try {
        await channel.send(message);
        result.sent.push(channel.key);
      } catch (error) {
        result.failed[channel.key] =
          error instanceof Error ? error.message : "bilinmeyen hata";
      }
    }),
  );

  return result;
}

/** Ayarlar doğru mu diye tek kanala deneme gönderir. */
export async function sendTest(key: string): Promise<{ ok: boolean; error?: string }> {
  const channel = findChannel(key);
  if (!channel) return { ok: false, error: "bilinmeyen kanal" };

  const problem = channel.problem();
  if (problem) return { ok: false, error: problem };

  try {
    await channel.send({
      severity: "info",
      title: "Sunucu Paneli — deneme bildirimi",
      detail:
        "Bu bir testtir. Bu mesajı gördüysen kanal ayarları doğru ve alarmlar buraya düşecek.",
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "bilinmeyen hata" };
  }
}

export type { NotifyMessage };
