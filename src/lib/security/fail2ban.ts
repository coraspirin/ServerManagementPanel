import "server-only";

import { getDb } from "@/lib/db/client";
import { callHelper, helperConfigured } from "@/lib/host/helper";
import { serverT } from "@/lib/i18n/runtime";

/**
 * M3.8 — fail2ban durumu ve başarısız giriş özeti.
 *
 * Panel BAN EKLEYEMİYOR, yalnızca okuyor ve ban KALDIRABİLİYOR. Sebep: ban
 * eklemek fail2ban'ın işi ve panelin bunu yapabilmesi, paneli ele geçiren
 * birine "istediğim IP'yi sunucudan kes" düğmesi vermek olurdu. Ban kaldırmak
 * ise kendini yanlışlıkla banlayan kullanıcının ihtiyacı.
 */

const ACTOR = { username: "panel", userId: 0 };

export type Jail = {
  name: string;
  currentlyFailed: number;
  totalFailed: number;
  currentlyBanned: number;
  totalBanned: number;
  bannedIps: string[];
};

export type Fail2banState = {
  available: boolean;
  message: string;
  setupHint: string | null;
  jails: Jail[];
};

const setupHint = () =>
  serverT("fail2ban.setupHint") +
  "\n" +
  "printf 'fail2ban.status\\nfail2ban.jail\\nfail2ban.unban\\n' >> /etc/panel-helper/allow.conf";

/** `fail2ban-client status` → "Jail list:\tsshd, nginx-auth" */
export function parseJailList(stdout: string): string[] {
  const match = stdout.match(/Jail list:\s*(.*)/);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * `fail2ban-client status <jail>` çıktısındaki sayılar ve IP listesi.
 *
 * Etiketler sürüme göre biraz değişebiliyor, bu yüzden anahtar kelimeyle
 * (currently failed / total failed …) eşleşiliyor, satır sırasıyla değil.
 */
export function parseJail(name: string, stdout: string): Jail {
  const number = (label: RegExp): number => {
    const match = stdout.match(label);
    return match ? Number(match[1]) : 0;
  };

  const bannedLine = stdout.match(/Banned IP list:\s*(.*)/);
  const bannedIps = bannedLine
    ? bannedLine[1]
        .split(/\s+/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    : [];

  return {
    name,
    currentlyFailed: number(/Currently failed:\s*(\d+)/i),
    totalFailed: number(/Total failed:\s*(\d+)/i),
    currentlyBanned: number(/Currently banned:\s*(\d+)/i),
    totalBanned: number(/Total banned:\s*(\d+)/i),
    bannedIps,
  };
}

function classify(error: string): { message: string; hint: string | null } {
  if (error.includes("bilinmeyen eylem")) { // i18n-ignore
    return {
      message: serverT("fail2ban.helperOutdated"),
      hint: setupHint(),
    };
  }
  if (error.includes("izinli değil")) { // i18n-ignore — host-helper protokol metni
    return {
      message: serverT("fail2ban.notAllowed"),
      hint: setupHint(),
    };
  }
  return { message: error, hint: null };
}

export async function fail2banState(): Promise<Fail2banState> {
  if (!helperConfigured()) {
    return {
      available: false,
      message: serverT("fail2ban.noHelper"),
      setupHint: null,
      jails: [],
    };
  }

  const status = await callHelper("fail2ban.status", {}, ACTOR);
  if (!status.ok) {
    const classified = classify(status.error ?? "");
    return {
      available: false,
      message: classified.message,
      setupHint: classified.hint,
      jails: [],
    };
  }

  const names = parseJailList(status.stdout ?? "");
  const jails: Jail[] = [];

  for (const name of names) {
    const detail = await callHelper("fail2ban.jail", { jail: name }, ACTOR);
    if (detail.ok) jails.push(parseJail(name, detail.stdout ?? ""));
  }

  const banned = jails.reduce((sum, jail) => sum + jail.currentlyBanned, 0);

  return {
    available: true,
    message:
      names.length === 0
        ? serverT("fail2ban.noJails")
        : serverT("fail2ban.summary", { jails: names.length, banned }),
    setupHint: null,
    jails,
  };
}

export async function unban(
  jail: string,
  ip: string,
  actor: { username: string; userId: number },
): Promise<{ ok: boolean; message: string }> {
  const response = await callHelper("fail2ban.unban", { jail, ip }, actor);
  return {
    ok: response.ok && (response.exitCode ?? 1) === 0,
    message: response.ok
      ? (response.stdout ?? "").trim() || serverT("fail2ban.unbanned")
      : (response.error ?? serverT("fail2ban.unbanFailed")),
  };
}

/* --- Panelin kendi başarısız girişleri --- */

export type FailedLogin = {
  username: string;
  ip: string;
  attempts: number;
  lastAt: number;
  lastDetail: string;
};

/**
 * Panelin KENDİ giriş denemeleri (audit_log'dan).
 *
 * fail2ban SSH'ı izliyor; panelin web girişi ayrı bir yüzey ve orada
 * olan bitenin kaydı yalnızca panelde. İkisini yan yana göstermek, "birisi
 * deniyor mu" sorusunun tam cevabını veriyor.
 */
export function failedLogins(sinceDays = 7, limit = 50): FailedLogin[] {
  return (
    getDb()
      .prepare(
        `SELECT username, ip, COUNT(*) AS attempts, MAX(ts) AS last_at,
                (SELECT detail FROM audit_log d
                  WHERE d.username = a.username AND d.ip = a.ip
                    AND d.action = 'auth.login' AND d.result = 'denied'
                  ORDER BY d.ts DESC LIMIT 1) AS last_detail
         FROM audit_log a
         WHERE a.action = 'auth.login' AND a.result = 'denied'
           AND a.ts > unixepoch() - ?
         GROUP BY username, ip
         ORDER BY attempts DESC, last_at DESC
         LIMIT ?`,
      )
      .all(sinceDays * 86400, limit) as Record<string, string | number | null>[]
  ).map((row) => ({
    username: String(row.username ?? ""),
    ip: String(row.ip ?? ""),
    attempts: Number(row.attempts),
    lastAt: Number(row.last_at),
    lastDetail: String(row.last_detail ?? ""),
  }));
}
