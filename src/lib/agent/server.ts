import "server-only";

import { isAgent } from "@/lib/env";
import { LOCAL_HOST_ID, runWithHost } from "@/lib/hosts/context";
import { agentFingerprint, agentSecret } from "./identity";
import { AGENT_OPS, agentHello } from "./ops";
import {
  AGENT_HEADERS,
  CLOCK_SKEW_SECONDS,
  decodeValue,
  encodeValue,
  enrollProof,
  verifyRequest,
  type EnrollResponse,
  type RpcRequest,
  type RpcResponse,
  type StreamFrame,
} from "./protocol";

/**
 * Ajan tarafı — imzalı isteği doğrular ve izinli işlemi çalıştırır.
 *
 * Route dosyaları yalnızca bu işlevleri çağırır; mantık burada toplu.
 */

// --- Tekrar oynatma koruması ------------------------------------------------

const nonces = new Map<string, number>();

function rememberNonce(nonce: string): boolean {
  const now = Date.now();
  if (nonces.size > 10_000) {
    for (const [key, expires] of nonces) if (expires < now) nonces.delete(key);
  }
  if (nonces.has(nonce)) return false;
  nonces.set(nonce, now + CLOCK_SKEW_SECONDS * 2 * 1000);
  return true;
}

// --- Başarısız deneme sınırı -------------------------------------------------

let failures: number[] = [];

function locked(): boolean {
  const since = Date.now() - 60_000;
  failures = failures.filter((at) => at > since);
  return failures.length >= 20;
}

// --- Ortak doğrulama -------------------------------------------------------

type Verified = { ok: true; body: string; secret: string } | { ok: false; response: Response };

async function verify(request: Request): Promise<Verified> {
  // Merkez rolündeki panel bu uçları hiç sunmaz.
  if (!isAgent()) return { ok: false, response: new Response(null, { status: 404 }) };

  const secret = agentSecret();
  if (!secret) {
    return { ok: false, response: Response.json({ error: "agent-not-configured" }, { status: 503 }) }; // i18n-ignore — protokol kodu
  }
  if (locked()) return { ok: false, response: Response.json({ error: "locked" }, { status: 429 }) }; // i18n-ignore — protokol kodu

  const body = await request.text();
  const result = verifyRequest(
    secret,
    {
      method: request.method,
      path: new URL(request.url).pathname,
      ts: request.headers.get(AGENT_HEADERS.ts),
      nonce: request.headers.get(AGENT_HEADERS.nonce),
      sig: request.headers.get(AGENT_HEADERS.sig),
      body,
    },
    Math.floor(Date.now() / 1000),
    rememberNonce,
  );

  if (!result.ok) {
    failures.push(Date.now());
    return { ok: false, response: Response.json({ error: result.reason }, { status: 401 }) };
  }
  return { ok: true, body, secret };
}

function parseRpc(body: string): RpcRequest | null {
  try {
    const value = decodeValue(body) as RpcRequest;
    if (typeof value?.op !== "string" || !Array.isArray(value.args)) return null;
    return { op: value.op, args: value.args, settings: value.settings ?? {} };
  } catch {
    return null;
  }
}

function errorOf(error: unknown): { message: string; code?: string } {
  const code = (error as { code?: unknown })?.code;
  return {
    message: error instanceof Error ? error.message : String(error),
    code: typeof code === "string" ? code : undefined,
  };
}

function reply(value: RpcResponse, status = 200): Response {
  return new Response(encodeValue(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// --- Uçlar -----------------------------------------------------------------

export async function handleRpc(request: Request): Promise<Response> {
  const verified = await verify(request);
  if (!verified.ok) return verified.response;

  const rpc = parseRpc(verified.body);
  if (!rpc) return reply({ ok: false, error: { message: "bad-request" } }, 400);

  const op = AGENT_OPS[rpc.op];
  if (!op || op.kind !== "call") return reply({ ok: false, error: { message: `unknown-op:${rpc.op}` } }, 404);

  try {
    const value = await runWithHost(LOCAL_HOST_ID, () => op.run(rpc.args, request.signal), {
      settings: rpc.settings,
    });
    return reply({ ok: true, value });
  } catch (error) {
    return reply({ ok: false, error: errorOf(error) });
  }
}

export async function handleStream(request: Request): Promise<Response> {
  const verified = await verify(request);
  if (!verified.ok) return verified.response;

  const rpc = parseRpc(verified.body);
  if (!rpc) return reply({ ok: false, error: { message: "bad-request" } }, 400);

  const op = AGENT_OPS[rpc.op];
  if (!op || op.kind !== "stream") return reply({ ok: false, error: { message: `unknown-op:${rpc.op}` } }, 404);

  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const encoder = new TextEncoder();
  const frame = (value: StreamFrame) => encoder.encode(`${encodeValue(value)}\n`);

  // Üreteç ayarlar katmanıyla birlikte ajanın bağlamında kurulur; sonraki
  // `next()` çağrıları da aynı bağlamda çalışsın diye her adım sarılıyor.
  const context = <T>(fn: () => T) => runWithHost(LOCAL_HOST_ID, fn, { settings: rpc.settings });
  const iterator = context(() => op.run(rpc.args, abort.signal));

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const step = await context(() => iterator.next());
        if (step.done) {
          controller.enqueue(frame({ t: "end" }));
          controller.close();
          return;
        }
        controller.enqueue(frame({ t: "d", d: step.value }));
      } catch (error) {
        controller.enqueue(frame({ t: "err", e: errorOf(error) }));
        controller.close();
      }
    },
    async cancel() {
      abort.abort();
      await iterator.return?.(undefined);
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" },
  });
}

/**
 * Kayıt: merkez imzalı bir nonce gönderir, ajan sertifika parmak izini
 * sırla imzalayıp döner. Merkez, TLS bağlantısında GERÇEKTEN gördüğü parmak
 * iziyle karşılaştırır.
 */
export async function handleEnroll(request: Request): Promise<Response> {
  const verified = await verify(request);
  if (!verified.ok) return verified.response;

  let nonce = "";
  try {
    nonce = String((JSON.parse(verified.body) as { nonce?: unknown }).nonce ?? "");
  } catch {
    nonce = "";
  }
  if (!/^[0-9a-f]{32,64}$/.test(nonce)) return Response.json({ error: "bad-nonce" }, { status: 400 }); // i18n-ignore — protokol kodu

  const fingerprint = agentFingerprint();
  if (!fingerprint) return Response.json({ error: "no-certificate" }, { status: 503 }); // i18n-ignore — protokol kodu

  const body: EnrollResponse = {
    fingerprint,
    proof: enrollProof(verified.secret, nonce, fingerprint),
    hello: await agentHello(),
  };
  return Response.json(body);
}
