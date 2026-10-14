import "server-only";

import {
  AGENT_HEADERS,
  ANNOUNCE_MAX_BYTES,
  ANNOUNCE_PATH,
  ANNOUNCE_WINDOW_SECONDS,
  announceUrl,
  parseAnnounce,
  verifyRequest,
} from "@/lib/agent/protocol";
import { audit } from "@/lib/auth/audit";
import { decryptSecret, type EncryptedValue } from "@/lib/crypto";
import { isAgent } from "@/lib/env";
import { serverT } from "@/lib/i18n/runtime";
import { dispatch } from "@/lib/notify";
import { clientIp } from "@/lib/request";
import { runWithHost } from "./context";
import { announceCandidates, getHost, saveAnnounce } from "./store";

/**
 * `POST /api/agent/announce` — native ajanın kendini duyurması (Faz B adım 6,
 * kararlar.md "Kurulum tek komut"). YALNIZ merkezde; ajan rolünde 404.
 *
 * Kimlik: istek RPC ile aynı imzayı taşır (ts/nonce/sig başlıkları), sır
 * olarak kayıt bekleyen sunucunun sırrı. Merkez, sırrı son
 * ANNOUNCE_WINDOW_SECONDS içinde üretilmiş bekleyen satırların her birini
 * dener (birkaç satır). Eşleşen satıra duyuru ÖNERİ olarak yazılır; sabitleme
 * yapılmaz — kullanıcı panelde onaylayınca mevcut enroll (parmak izi
 * kanıtı) çalışır.
 *
 * Kötüye kullanım sınırı: kaynak başına 10 dk'da 20, toplamda 200 istek; her
 * başarısız deneme bir sayaç tüketir (sır tahmini anlamsız: 32 baytlık sır).
 */

const WINDOW_MS = 10 * 60_000;
const PER_SOURCE = 20;
const TOTAL = 200;

const attempts = new Map<string, number[]>();

function rateLimited(source: string, now: number): boolean {
  let total = 0;
  for (const [key, stamps] of attempts) {
    const fresh = stamps.filter((stamp) => now - stamp < WINDOW_MS);
    if (fresh.length === 0) attempts.delete(key);
    else attempts.set(key, fresh);
    total += fresh.length;
  }
  const mine = attempts.get(source) ?? [];
  if (mine.length >= PER_SOURCE || total >= TOTAL) return true;
  mine.push(now);
  attempts.set(source, mine);
  return false;
}

const nonces = new Map<string, number>();

function rememberNonce(nonce: string, now: number): boolean {
  for (const [key, expires] of nonces) if (expires < now) nonces.delete(key);
  if (nonces.has(nonce)) return false;
  nonces.set(nonce, now + 5 * 60_000);
  return true;
}

const json = (body: unknown, status: number) => Response.json(body, { status });

export async function handleAnnounce(request: Request): Promise<Response> {
  if (isAgent()) return new Response(null, { status: 404 });

  const now = Date.now();
  const sourceIp = clientIp(request);
  if (rateLimited(sourceIp || "-", now)) return json({ error: "rate-limited" }, 429);

  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > ANNOUNCE_MAX_BYTES) return json({ error: "too-large" }, 413);
  const body = await request.text();
  if (body.length > ANNOUNCE_MAX_BYTES) return json({ error: "too-large" }, 413);

  const announce = parseAnnounce(body);
  if (!announce) return json({ error: "bad-request" }, 400);

  const input = {
    method: "POST",
    path: ANNOUNCE_PATH,
    ts: request.headers.get(AGENT_HEADERS.ts),
    nonce: request.headers.get(AGENT_HEADERS.nonce),
    sig: request.headers.get(AGENT_HEADERS.sig),
    body,
  };
  const seconds = Math.floor(now / 1000);

  for (const candidate of announceCandidates(ANNOUNCE_WINDOW_SECONDS)) {
    let secret: string;
    try {
      secret = decryptSecret(JSON.parse(candidate.tokenEnc) as EncryptedValue);
    } catch {
      continue;
    }
    const verdict = verifyRequest(secret, input, seconds, (nonce) => rememberNonce(nonce, now));
    if (!verdict.ok) {
      // Saat ya da tekrar: imza bu sırla DOĞRU ama istek geçersiz — başka
      // satırı denemenin anlamı yok, ajana nedenini söyle.
      if (verdict.reason === "clock" || verdict.reason === "replay") return json({ error: verdict.reason }, 401);
      continue;
    }

    const host = getHost(candidate.id);
    if (!host) break;
    const url = announceUrl(announce);
    const first = host.announce === null || host.announce.url !== url || host.announce.fingerprint !== announce.fingerprint;
    saveAnnounce(candidate.id, {
      url,
      fingerprint: announce.fingerprint,
      version: announce.version,
      hostname: announce.hostname,
      osName: announce.osName,
      sourceIp,
      at: seconds,
    });

    // Ajan onaylanana kadar dakikada bir yeniden duyurur: kayıt ve bildirim
    // yalnız ilk kez (ya da adres/sertifika değişince).
    if (first) {
      audit({
        action: "hosts.announce",
        targetType: "host",
        targetId: String(host.id),
        detail: `${url} ${announce.hostname} v${announce.version}`,
        ip: sourceIp,
      });
      void runWithHost(host.id, () =>
        dispatch({
          severity: "info",
          title: serverT("hosts.announce.notifyTitle"),
          detail: serverT("hosts.announce.notifyDetail", { host: host.name, url, hostname: announce.hostname }),
        }),
      ).catch(() => undefined);
    }
    return json({ ok: true }, 202);
  }

  return json({ error: "signature" }, 401);
}
