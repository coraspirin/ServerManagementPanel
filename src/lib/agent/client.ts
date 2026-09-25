import "server-only";

import { randomBytes } from "node:crypto";
import http from "node:http";
import tls from "node:tls";
import { decryptSecret, type EncryptedValue } from "@/lib/crypto";
import { HostError } from "@/lib/hosts/errors";
import { hostTokenEnc } from "@/lib/hosts/store";
import type { Host } from "@/lib/hosts/types";
import { serverT } from "@/lib/i18n/runtime";
import { resolvedSettingsFor } from "@/lib/settings";
import {
  AGENT_HEADERS,
  decodeValue,
  encodeValue,
  normalizeFingerprint,
  signRequest,
  type RpcResponse,
  type StreamFrame,
} from "./protocol";

/**
 * Merkez → ajan istemcisi.
 *
 * TLS bağlantısı ELLE kuruluyor: önce el sıkışma, sonra parmak izi
 * karşılaştırması, ancak ondan sonra HTTP isteği yazılıyor. `https.request`
 * kullanılsaydı gövde (içinde yedek parolası gibi değerler olabilir)
 * doğrulamadan önce kabloya çıkabilirdi.
 */

const CONNECT_TIMEOUT_MS = 8_000;
const DEFAULT_TIMEOUT_MS = 60_000;

/** Uzun süren işlemlerin zaman aşımı. */
const OP_TIMEOUTS: Record<string, number> = {
  "docker.runThrowaway": 60 * 60_000,
  "docker.runOnce": 10 * 60_000,
  "docker.exportImage": 30 * 60_000,
  "docker.prune": 10 * 60_000,
  "docker.createVolume": 10 * 60_000,
};

type Target = { hostname: string; port: number };

export function parseAgentUrl(raw: string): Target | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (url.pathname !== "/" || url.search || url.hash) return null;
  return { hostname: url.hostname.replace(/^\[|\]$/g, ""), port: Number(url.port || 443) };
}

function secretOf(host: Pick<Host, "id">): string {
  const raw = hostTokenEnc(host.id);
  if (!raw) throw new HostError("authFailed", host.id, serverT("hosts.errors.authFailed"));
  return decryptSecret(JSON.parse(raw) as EncryptedValue);
}

// --- Ayar katmanı -----------------------------------------------------------

const settingsCache = new Map<number, { at: number; value: Record<string, unknown> }>();

function settingsFor(hostId: number): Record<string, unknown> {
  const cached = settingsCache.get(hostId);
  if (cached && Date.now() - cached.at < 10_000) return cached.value;
  const value = resolvedSettingsFor(hostId);
  settingsCache.set(hostId, { at: Date.now(), value });
  return value;
}

// --- Taşıma ----------------------------------------------------------------

export type AgentExchange = {
  status: number;
  /** Bağlantıda GÖRÜLEN sertifikanın parmak izi (kayıtta kullanılır). */
  fingerprint: string;
  response: http.IncomingMessage;
};

function offline(hostId: number, detail?: string): HostError {
  return new HostError("offline", hostId, detail ? `${serverT("hosts.errors.offline")} (${detail})` : serverT("hosts.errors.offline"));
}

/**
 * İmzalı POST. `pinned` null ise (yalnızca kayıt sırasında) parmak izi
 * karşılaştırılmaz; görülen değer döner ve çağıran kanıtla doğrular.
 */
export function agentExchange(
  host: Pick<Host, "id">,
  target: Target,
  secret: string,
  pinned: string | null,
  path: string,
  body: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<AgentExchange> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };

    const socket = tls.connect({
      host: target.hostname,
      port: target.port,
      // Güven CA'dan değil sabitlenmiş parmak izinden geliyor.
      rejectUnauthorized: false,
    });

    const connectTimer = setTimeout(() => fail(offline(host.id, "timeout")), CONNECT_TIMEOUT_MS);
    // `on`, `once` değil: yanıt okunurken gelen soket hatası da yakalanmalı,
    // yoksa işlenmemiş 'error' olayı süreci düşürür.
    socket.on("error", (error) => fail(offline(host.id, (error as NodeJS.ErrnoException).code ?? error.message)));

    if (options.signal) {
      if (options.signal.aborted) return fail(new Error("aborted"));
      options.signal.addEventListener("abort", () => fail(new Error("aborted")), { once: true });
    }

    socket.once("secureConnect", () => {
      clearTimeout(connectTimer);
      const fingerprint = socket.getPeerCertificate().fingerprint256 ?? "";
      if (pinned && normalizeFingerprint(fingerprint) !== normalizeFingerprint(pinned)) {
        return fail(new HostError("pinMismatch", host.id, serverT("hosts.errors.pinMismatch")));
      }

      const ts = String(Math.floor(Date.now() / 1000));
      const nonce = randomBytes(16).toString("hex");
      const request = http.request({
        createConnection: () => socket,
        method: "POST",
        path,
        headers: {
          host: `${target.hostname}:${target.port}`,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          [AGENT_HEADERS.ts]: ts,
          [AGENT_HEADERS.nonce]: nonce,
          [AGENT_HEADERS.sig]: signRequest(secret, { method: "POST", path, ts, nonce, body }),
        },
      });

      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const timer = timeoutMs > 0 ? setTimeout(() => fail(offline(host.id, "timeout")), timeoutMs) : null;
      request.once("error", (error) => fail(offline(host.id, error.message)));
      request.once("response", (response) => {
        if (timer) clearTimeout(timer);
        if (settled) return;
        settled = true;
        resolve({ status: response.statusCode ?? 0, fingerprint, response });
      });
      request.end(body);
    });
  });
}

async function readAll(response: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of response) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function statusError(host: Pick<Host, "id">, status: number, text: string): Error {
  if (status === 401) return new HostError("authFailed", host.id, serverT("hosts.errors.authFailed"));
  if (status === 404) return new HostError("incompatible", host.id, serverT("hosts.errors.incompatible"));
  if (status === 429 || status === 503) return offline(host.id, text.slice(0, 120));
  return new Error(`agent HTTP ${status}: ${text.slice(0, 200)}`);
}

function targetOf(host: Host): Target {
  const target = host.agentUrl ? parseAgentUrl(host.agentUrl) : null;
  if (!target || !host.certFingerprint) {
    throw new HostError("unsupported", host.id, serverT("hosts.errors.unsupported"));
  }
  return target;
}

function remoteError(error: { message: string; code?: string }): Error {
  const out = new Error(error.message) as Error & { code?: string };
  if (error.code) out.code = error.code;
  return out;
}

// --- Genel API ---------------------------------------------------------------

export async function agentCall<T = unknown>(
  host: Host,
  op: string,
  args: unknown[] = [],
  options: { timeoutMs?: number } = {},
): Promise<T> {
  const body = encodeValue({ op, args, settings: settingsFor(host.id) });
  const { status, response } = await agentExchange(
    host,
    targetOf(host),
    secretOf(host),
    host.certFingerprint,
    "/api/agent/rpc",
    body,
    { timeoutMs: options.timeoutMs ?? OP_TIMEOUTS[op] ?? DEFAULT_TIMEOUT_MS },
  );
  const text = await readAll(response);
  if (status !== 200) throw statusError(host, status, text);
  const reply = decodeValue(text) as RpcResponse;
  if (!reply.ok) throw remoteError(reply.error);
  return reply.value as T;
}

export async function* agentStream<T = unknown>(
  host: Host,
  op: string,
  args: unknown[],
  signal?: AbortSignal,
): AsyncGenerator<T> {
  const body = encodeValue({ op, args, settings: settingsFor(host.id) });
  const { status, response } = await agentExchange(
    host,
    targetOf(host),
    secretOf(host),
    host.certFingerprint,
    "/api/agent/stream",
    body,
    { timeoutMs: 0, signal },
  );
  if (status !== 200) throw statusError(host, status, await readAll(response));

  const close = () => response.destroy();
  signal?.addEventListener("abort", close, { once: true });
  try {
    let buffer = "";
    for await (const chunk of response) {
      buffer += (chunk as Buffer).toString("utf8");
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const frame = decodeValue(line) as StreamFrame;
        if (frame.t === "d") yield frame.d as T;
        else if (frame.t === "err") throw remoteError(frame.e);
        else return;
      }
    }
  } finally {
    signal?.removeEventListener("abort", close);
    close();
  }
}
