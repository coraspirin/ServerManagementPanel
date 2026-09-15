import "server-only";

import { SEVERITY_LABEL, type Severity } from "@/lib/alerts/types";
import { getBool, getNumber, getString } from "@/lib/settings";
import type { NotifyChannel, NotifyMessage } from "./types";

/**
 * M1.3 — bildirim kanalları.
 *
 * Hepsi HTTP tabanlı (e-posta hariç) ve `fetch` ile gönderiliyor; zaman aşımı
 * ZORUNLU: yanıt vermeyen bir bildirim servisi alarm turunu kilitlememeli.
 */

const TIMEOUT_MS = 10_000;

const EMOJI: Record<Severity, string> = {
  ok: "✅",
  info: "ℹ️",
  warning: "⚠️",
  critical: "🔴",
};

function subject(message: NotifyMessage): string {
  return `${EMOJI[message.severity]} ${message.title}`;
}

const TURKISH_ASCII: Record<string, string> = {
  ç: "c", Ç: "C", ğ: "g", Ğ: "G", ı: "i", İ: "I",
  ö: "o", Ö: "O", ş: "s", Ş: "S", ü: "u", Ü: "U",
};

/**
 * ASCII-only başlık isteyen protokoller için (ntfy'nin `Title` başlığı).
 *
 * Türkçe harfleri SİLMEK yerine karşılıklarına çeviriyoruz: "doluluğu normale
 * döndü" silinince "doluluu normale dnd" olup okunmaz hale geliyordu.
 */
function toAscii(text: string): string {
  return text
    .replace(/[çÇğĞıİöÖşŞüÜ]/g, (char) => TURKISH_ASCII[char] ?? char)
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function plainText(message: NotifyMessage): string {
  const level = SEVERITY_LABEL[message.severity].toLocaleUpperCase("tr");
  return `${subject(message)}\n\n${message.detail}\n\n[${level}]`;
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = (await response.text().catch(() => "")).slice(0, 200);
    throw new Error(`HTTP ${response.status}${text ? ` — ${text}` : ""}`);
  }
}

/**
 * Sunucu adresini kullanılabilir hale getirir.
 *
 * Şema unutmak bu alanların en sık hatası: kullanıcı `192.168.61.114:8123`
 * yazıyor, `fetch` "Failed to parse URL" diyor ve mesaj sorunun ADRESTE
 * olduğunu söylemiyor. Yardım metnine örnek yazmak yetmedi — bu yüzden panel
 * eksik şemayı kendisi tamamlıyor.
 *
 * `http` seçiliyor, `https` değil: bu alanlara yazılan adresler neredeyse her
 * zaman yerel ağdaki bir servis ve oralarda TLS yok. Şemayı açıkça yazan
 * kullanıcının tercihine dokunulmuyor.
 */
function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (trimmed === "") return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

/** Ayar boşsa hangi alanın eksik olduğunu söyleyen yardımcı. */
function missing(pairs: [string, string][]): string | null {
  const empty = pairs.filter(([, value]) => value.trim() === "").map(([label]) => label);
  return empty.length > 0 ? `eksik ayar: ${empty.join(", ")}` : null;
}

// --- Telegram --------------------------------------------------------------

const telegram: NotifyChannel = {
  key: "telegram",
  label: "Telegram",
  problem() {
    return missing([
      ["bot token", getString("notify.telegram.token")],
      ["chat id", getString("notify.telegram.chat_id")],
    ]);
  },
  async send(message) {
    await postJson(
      `https://api.telegram.org/bot${getString("notify.telegram.token")}/sendMessage`,
      {
        chat_id: getString("notify.telegram.chat_id"),
        text: plainText(message),
        disable_notification: message.severity === "ok" || message.severity === "info",
      },
    );
  },
};

// --- Home Assistant --------------------------------------------------------

const homeAssistant: NotifyChannel = {
  key: "ha",
  label: "Home Assistant",
  problem() {
    return missing([
      ["sunucu adresi", getString("notify.ha.url")],
      ["token", getString("notify.ha.token")],
      ["bildirim servisi", getString("notify.ha.service")],
    ]);
  },
  async send(message) {
    const base = normalizeBaseUrl(getString("notify.ha.url"));
    // Ayarda "notify.mobile_app_telefonum" gibi tam servis adı bekleniyor;
    // REST API alan adı ile servisi ayrı yollarda ister.
    const service = getString("notify.ha.service").trim();
    const [domain, ...rest] = service.split(".");
    const name = rest.join(".");
    if (!name) throw new Error(`servis adı 'alan.servis' biçiminde olmalı: ${service}`);

    await postJson(
      `${base}/api/services/${domain}/${name}`,
      { title: subject(message), message: message.detail },
      { authorization: `Bearer ${getString("notify.ha.token")}` },
    );
  },
};

// --- ntfy ------------------------------------------------------------------

const NTFY_PRIORITY: Record<Severity, string> = {
  ok: "low",
  info: "default",
  warning: "high",
  critical: "urgent",
};

const ntfy: NotifyChannel = {
  key: "ntfy",
  label: "ntfy",
  problem() {
    return missing([
      ["sunucu adresi", getString("notify.ntfy.url")],
      ["konu", getString("notify.ntfy.topic")],
    ]);
  },
  async send(message) {
    const base = normalizeBaseUrl(getString("notify.ntfy.url"));
    const token = getString("notify.ntfy.token").trim();

    const response = await fetch(`${base}/${getString("notify.ntfy.topic")}`, {
      method: "POST",
      headers: {
        // ntfy başlıkları ASCII ister; Türkçe harfler karşılıklarına çevrilir,
        // tam metin gövdede zaten var.
        Title: toAscii(message.title) || "Sunucu Paneli",
        Priority: NTFY_PRIORITY[message.severity],
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: `${message.title}\n\n${message.detail}`,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  },
};

// --- Discord ---------------------------------------------------------------

const DISCORD_COLOR: Record<Severity, number> = {
  ok: 0x2ecc71,
  info: 0x3498db,
  warning: 0xf39c12,
  critical: 0xe74c3c,
};

const discord: NotifyChannel = {
  key: "discord",
  label: "Discord",
  problem() {
    return missing([["webhook adresi", getString("notify.discord.webhook")]]);
  },
  async send(message) {
    await postJson(getString("notify.discord.webhook"), {
      embeds: [
        {
          title: subject(message),
          description: message.detail.slice(0, 4000),
          color: DISCORD_COLOR[message.severity],
          timestamp: new Date().toISOString(),
        },
      ],
    });
  },
};

// --- E-posta ---------------------------------------------------------------

const email: NotifyChannel = {
  key: "email",
  label: "E-posta",
  problem() {
    return missing([
      ["SMTP sunucusu", getString("notify.email.smtp_host")],
      ["gönderen", getString("notify.email.from")],
      ["alıcı", getString("notify.email.to")],
    ]);
  },
  async send(message) {
    // nodemailer yalnızca gerçekten gönderim yapılırken yükleniyor: SMTP
    // kullanılmayan kurulumlarda paket hiç çözümlenmesin.
    const { createTransport } = await import("nodemailer");

    const user = getString("notify.email.user").trim();
    const transport = createTransport({
      host: getString("notify.email.smtp_host"),
      port: getNumber("notify.email.smtp_port"),
      secure: getBool("notify.email.secure"),
      ...(user ? { auth: { user, pass: getString("notify.email.password") } } : {}),
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
    });

    await transport.sendMail({
      from: getString("notify.email.from"),
      to: getString("notify.email.to")
        .split(",")
        .map((address) => address.trim())
        .filter(Boolean),
      subject: subject(message),
      text: plainText(message),
    });
  },
};

export const notifyChannels: NotifyChannel[] = [
  telegram,
  homeAssistant,
  ntfy,
  discord,
  email,
];

export function findChannel(key: string): NotifyChannel | undefined {
  return notifyChannels.find((channel) => channel.key === key);
}
