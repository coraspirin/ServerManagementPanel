import "server-only";

import { X509Certificate } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/db/client";

/**
 * Ajanın kimliği: merkezle paylaşılan sır ve TLS sertifikası.
 *
 * Sır `AGENT_TOKEN` ortam değişkeninden gelir (merkezin "sunucu ekle"
 * ekranında bir kez gösterdiği değer). Sertifikayı `docker-entry.mjs`
 * açılışta üretir; burada yalnızca parmak izi okunur — kayıt kanıtı bu
 * parmak izine bağlanıyor.
 */

export function agentSecret(): string | null {
  const value = (process.env.AGENT_TOKEN ?? "").trim();
  return value.length >= 32 ? value : null;
}

export function agentCertPath(): string {
  return process.env.AGENT_CERT ?? path.join(dataDir(), "agent", "cert.pem");
}

let cachedFingerprint: string | null = null;

/** sha256 parmak izi ("AA:BB:..") — sertifika yoksa null. */
export function agentFingerprint(): string | null {
  if (cachedFingerprint) return cachedFingerprint;
  const file = agentCertPath();
  if (!existsSync(file)) return null;
  cachedFingerprint = new X509Certificate(readFileSync(file)).fingerprint256;
  return cachedFingerprint;
}
