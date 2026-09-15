import "server-only";

import { decryptSecret, encryptSecret, type EncryptedValue } from "@/lib/crypto";
import { getDb } from "@/lib/db/client";
import { getString } from "@/lib/settings";

/**
 * M2.8 — DDNS.
 *
 * Ev IP'si değiştiğinde dışarı açılan alan adları sessizce ölür ve bunu ancak
 * "içeri giremiyorum" diye fark edersin. Bu iş IP'yi periyodik kontrol edip
 * değiştiğinde kaydı günceller.
 *
 * Sağlayıcılar kasten AZ: Cloudflare (alan adı sahibi olanlar) ve DuckDNS
 * (olmayanlar). Her ikisi de anahtar/token ile çalışıyor ve token T3 ile
 * şifreli saklanıyor.
 */

const TIMEOUT_MS = 10_000;

export type DdnsProvider = "cloudflare" | "duckdns";

export type DdnsRecord = {
  id: number;
  provider: DdnsProvider;
  hostname: string;
  zone: string;
  enabled: boolean;
  lastIp: string;
  lastSyncAt: number | null;
  lastError: string;
  /** Token kayıtlı mı — DEĞERİ hiç istemciye gitmez. */
  hasSecret: boolean;
};

type Row = {
  id: number;
  provider: string;
  hostname: string;
  zone: string;
  secret: string;
  enabled: number;
  last_ip: string;
  last_sync_at: number | null;
  last_error: string;
};

function toRecord(row: Row): DdnsRecord {
  return {
    id: row.id,
    provider: row.provider as DdnsProvider,
    hostname: row.hostname,
    zone: row.zone,
    enabled: row.enabled === 1,
    lastIp: row.last_ip,
    lastSyncAt: row.last_sync_at,
    lastError: row.last_error,
    hasSecret: row.secret !== "",
  };
}

export function listDdnsRecords(): DdnsRecord[] {
  return (
    getDb().prepare("SELECT * FROM ddns_records ORDER BY hostname").all() as Row[]
  ).map(toRecord);
}

export function getDdnsRecord(id: number): DdnsRecord | null {
  const row = getDb().prepare("SELECT * FROM ddns_records WHERE id = ?").get(id) as
    | Row
    | undefined;
  return row ? toRecord(row) : null;
}

/** Çözülemezse null — MASTER_KEY değişmişse panel çökmemeli (M2.6'daki ders). */
function readSecret(id: number): string | null {
  const row = getDb().prepare("SELECT secret FROM ddns_records WHERE id = ?").get(id) as
    | { secret: string }
    | undefined;
  if (!row || row.secret === "") return "";

  try {
    return decryptSecret(JSON.parse(row.secret) as EncryptedValue);
  } catch {
    return null;
  }
}

export type DdnsInput = {
  provider: DdnsProvider;
  hostname: string;
  zone: string;
  enabled: boolean;
};

export function saveDdnsRecord(
  id: number | null,
  input: DdnsInput,
  secret: string,
): number {
  const db = getDb();
  // Boş token "değiştirme" demek: form gizli değeri geri göndermiyor.
  const encrypted = secret.trim() === "" ? null : JSON.stringify(encryptSecret(secret));

  if (id === null) {
    const result = db
      .prepare(
        "INSERT INTO ddns_records (provider, hostname, zone, secret, enabled) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        input.provider,
        input.hostname.trim(),
        input.zone.trim(),
        encrypted ?? "",
        input.enabled ? 1 : 0,
      );
    return Number(result.lastInsertRowid);
  }

  db.prepare(
    `UPDATE ddns_records
     SET provider = ?, hostname = ?, zone = ?, enabled = ?,
         secret = COALESCE(?, secret)
     WHERE id = ?`,
  ).run(
    input.provider,
    input.hostname.trim(),
    input.zone.trim(),
    input.enabled ? 1 : 0,
    encrypted,
    id,
  );
  return id;
}

export function deleteDdnsRecord(id: number): void {
  getDb().prepare("DELETE FROM ddns_records WHERE id = ?").run(id);
}

/**
 * Dışarıdan görünen IP.
 *
 * Servis ayardan geliyor: kullanılan uç kapanabilir ve panelin yeniden
 * derlenmesini gerektirmemeli. Yanıtın düz metin bir IP olması bekleniyor.
 */
export async function publicIp(): Promise<string> {
  const url = getString("proxy.public_ip_url").trim();
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`IP servisi HTTP ${response.status}`);

  const text = (await response.text()).trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) {
    throw new Error(`IP servisi beklenmedik yanıt verdi: ${text.slice(0, 60)}`);
  }
  return text;
}

async function updateCloudflare(
  record: DdnsRecord,
  token: string,
  ip: string,
): Promise<void> {
  const base = "https://api.cloudflare.com/client/v4";
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  // Kayıt id'si saklanmıyor, her turda aranıyor: kullanıcı Cloudflare
  // panelinden kaydı silip yeniden oluşturursa id değişir ve sakladığımız
  // değer sessizce ölürdü.
  const search = await fetch(
    `${base}/zones/${record.zone}/dns_records?type=A&name=${encodeURIComponent(record.hostname)}`,
    { headers, signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  const found = (await search.json()) as {
    success?: boolean;
    result?: { id: string }[];
    errors?: { message: string }[];
  };

  if (!search.ok || !found.success) {
    throw new Error(found.errors?.[0]?.message ?? `Cloudflare HTTP ${search.status}`);
  }

  const existing = found.result?.[0];
  const body = JSON.stringify({
    type: "A",
    name: record.hostname,
    content: ip,
    ttl: 60,
    proxied: false,
  });

  const response = await fetch(
    existing ? `${base}/zones/${record.zone}/dns_records/${existing.id}` : `${base}/zones/${record.zone}/dns_records`,
    {
      method: existing ? "PUT" : "POST",
      headers,
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );

  const payload = (await response.json()) as { success?: boolean; errors?: { message: string }[] };
  if (!response.ok || !payload.success) {
    throw new Error(payload.errors?.[0]?.message ?? `Cloudflare HTTP ${response.status}`);
  }
}

async function updateDuckDns(record: DdnsRecord, token: string, ip: string): Promise<void> {
  // DuckDNS alt alan adını ister, tam adı değil: "evim.duckdns.org" → "evim".
  const domain = record.hostname.replace(/\.duckdns\.org$/i, "");
  const response = await fetch(
    `https://www.duckdns.org/update?domains=${encodeURIComponent(domain)}&token=${encodeURIComponent(token)}&ip=${ip}`,
    { signal: AbortSignal.timeout(TIMEOUT_MS) },
  );

  const text = (await response.text()).trim();
  // DuckDNS HTTP 200 ile "KO" döndürebiliyor; durum koduna bakmak yetmez.
  if (text !== "OK") throw new Error(`DuckDNS yanıtı: ${text || "(boş)"}`);
}

export type SyncResult = { updated: string[]; unchanged: string[]; failed: string[] };

export async function syncDdns(): Promise<SyncResult> {
  const records = listDdnsRecords().filter((record) => record.enabled);
  const result: SyncResult = { updated: [], unchanged: [], failed: [] };
  if (records.length === 0) return result;

  let ip: string;
  try {
    ip = await publicIp();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { updated: [], unchanged: [], failed: [`genel IP okunamadı: ${message}`] };
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  for (const record of records) {
    // IP değişmediyse sağlayıcıya gitmiyoruz: DuckDNS ve Cloudflare istek
    // sınırı uyguluyor ve dakikada bir gereksiz güncelleme göndermenin
    // kimseye faydası yok.
    if (record.lastIp === ip) {
      result.unchanged.push(record.hostname);
      continue;
    }

    const token = readSecret(record.id);
    if (token === null || token === "") {
      const message =
        token === null
          ? "token çözülemiyor (MASTER_KEY değişmiş olabilir)"
          : "token girilmemiş";
      db.prepare("UPDATE ddns_records SET last_error = ? WHERE id = ?").run(message, record.id);
      result.failed.push(`${record.hostname}: ${message}`);
      continue;
    }

    try {
      if (record.provider === "cloudflare") await updateCloudflare(record, token, ip);
      else await updateDuckDns(record, token, ip);

      db.prepare(
        "UPDATE ddns_records SET last_ip = ?, last_sync_at = ?, last_error = '' WHERE id = ?",
      ).run(ip, now, record.id);
      result.updated.push(`${record.hostname} → ${ip}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      db.prepare("UPDATE ddns_records SET last_error = ?, last_sync_at = ? WHERE id = ?").run(
        message,
        now,
        record.id,
      );
      result.failed.push(`${record.hostname}: ${message}`);
    }
  }

  return result;
}
