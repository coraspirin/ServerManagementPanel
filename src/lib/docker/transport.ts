import { AsyncLocalStorage } from "node:async_hooks";
import http from "node:http";
import type { Duplex } from "node:stream";
import { serverT } from "../i18n/runtime.ts";

/**
 * Docker Engine API'ye giden yol (kararlar.md K2).
 *
 * Docker'ı konuşan kod (`providers/docker.live.ts`, `docker/exec.ts`,
 * `docker/events.ts`) soket yolunu bilmez; isteği geçerli taşımaya verir:
 *  - yerel: bu makinedeki docker.sock (`localDockerTransport`)
 *  - uzak: ajanın `docker.api` tüneli (`transport.remote.ts`)
 *
 * Taşıma, çağrı zincirine `runWithDockerTransport` ile bağlanır (sunucu
 * bağlamındaki `runWithHost` ile aynı kalıp): ~800 satırlık sağlayıcının
 * imzaları değişmez, uzak sunucu için aynı nesne `bindDockerTransport` ile
 * sarılır. Bağlam yoksa yerel soket — ajan sürecinde ve tek sunuculu
 * kurulumda davranış eskisiyle aynı.
 *
 * `fetch` kullanılmıyor: Unix soketine bağlanmak için dispatcher gerekiyor ve
 * bu, ek bağımlılık (undici) demek. `node:http` soketi doğrudan destekliyor.
 */

export type DockerMethod = "GET" | "HEAD" | "POST" | "PUT" | "DELETE";

export type DockerRequest = {
  method?: DockerMethod;
  path: string;
  headers?: Record<string, string>;
  body?: Buffer | string;
  /** Yanıtın tamamı için süre sınırı; 0 = sınırsız. Varsayılan 5 sn. */
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type DockerReply = { status: number; headers: Record<string, string>; body: Buffer };

/** Akış yanıtı: gövde parça parça okunur, `close()` bağlantıyı bırakır. */
export type DockerStreamReply = {
  status: number;
  headers: Record<string, string>;
  body: AsyncIterable<Buffer>;
  close(): void;
};

export interface DockerTransport {
  /** Uzak/yerel ayrımı teşhis ve günlük için. */
  readonly kind: "local" | "remote";
  request(request: DockerRequest): Promise<DockerReply>;
  stream(request: DockerRequest): Promise<DockerStreamReply>;
  /**
   * Etkileşimli exec (`/exec/{id}/start` hijack). Yalnız yerel: tünel
   * iki yönlü akış taşımaz, uzakta terminal `exec.*` op'larıyla çalışır.
   */
  hijack?(request: DockerRequest): Promise<Duplex>;
}

export const DOCKER_SOCKET_PATH = process.env.DOCKER_SOCKET ?? "/var/run/docker.sock";

export class DockerTimeoutError extends Error {
  constructor() {
    super(serverT("dockerLive.socketTimeout"));
    this.name = "DockerTimeoutError";
  }
}

function headersOf(message: http.IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(message.headers)) {
    if (value !== undefined) out[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

function open(socketPath: string, request: DockerRequest, timeoutMs: number): {
  req: http.ClientRequest;
  response: Promise<http.IncomingMessage>;
} {
  const body = request.body === undefined ? null : Buffer.isBuffer(request.body) ? request.body : Buffer.from(request.body);
  const headers: Record<string, string | number> = { ...(request.headers ?? {}) };
  if (body) headers["content-length"] = body.length;

  /*
    Süresiz istek (akış: olaylar, takip edilen log, yedek ilerlemesi) ORTAK
    ajanı kullanmaz ve zaman aşımı dinleyicisi almaz. Node 20+'nın varsayılan
    ajanı soketlere 5 sn boşta kalma süresi koyuyor; dinleyici takılı olsaydı
    sessiz kalan her akış 5 sn'de koparılırdı (2026-10-14'te canlıda yaşandı:
    olay akışı sürekli yeniden bağlanıp son olayı tekrar yazdı).
  */
  const req = http.request({
    socketPath,
    path: request.path,
    method: request.method ?? "GET",
    headers,
    ...(timeoutMs > 0 ? { timeout: timeoutMs } : { agent: false }),
  });
  const response = new Promise<http.IncomingMessage>((resolve, reject) => {
    req.on("response", resolve);
    req.on("error", reject);
  });
  if (timeoutMs > 0) req.on("timeout", () => req.destroy(new DockerTimeoutError()));
  request.signal?.addEventListener("abort", () => req.destroy(), { once: true });
  if (body) req.write(body);
  req.end();
  return { req, response };
}

/** Bu makinedeki Docker soketi. */
export function localDockerTransport(socketPath: string = DOCKER_SOCKET_PATH): DockerTransport {
  return {
    kind: "local",
    async request(request) {
      const { response } = open(socketPath, request, request.timeoutMs ?? 5000);
      const message = await response;
      const chunks: Buffer[] = [];
      for await (const chunk of message) chunks.push(chunk as Buffer);
      return { status: message.statusCode ?? 0, headers: headersOf(message), body: Buffer.concat(chunks) };
    },
    async stream(request) {
      const { req, response } = open(socketPath, request, request.timeoutMs ?? 0);
      const message = await response;
      return {
        status: message.statusCode ?? 0,
        headers: headersOf(message),
        body: message as AsyncIterable<Buffer>,
        close: () => {
          message.destroy();
          req.destroy();
        },
      };
    },
    hijack(request) {
      return new Promise<Duplex>((resolve, reject) => {
        const body = request.body === undefined ? "" : request.body;
        const req = http.request({
          socketPath,
          path: request.path,
          method: request.method ?? "POST",
          headers: {
            ...(request.headers ?? {}),
            "content-length": Buffer.byteLength(body),
            Connection: "Upgrade",
            Upgrade: "tcp",
          },
        });
        req.on("upgrade", (_res, upgraded) => resolve(upgraded));
        // Docker bazı sürümlerde yükseltme yapmadan doğrudan akışa geçer.
        req.on("response", (res) => resolve(res as unknown as Duplex));
        req.on("error", reject);
        req.write(body);
        req.end();
      });
    },
  };
}

// --- Bağlam ----------------------------------------------------------------

const storage = new AsyncLocalStorage<DockerTransport>();
let localDefault: DockerTransport | null = null;

/** Geçerli taşıma; bağlam yoksa yerel soket. */
export function dockerTransport(): DockerTransport {
  const bound = storage.getStore();
  if (bound) return bound;
  localDefault ??= localDockerTransport();
  return localDefault;
}

export function runWithDockerTransport<T>(transport: DockerTransport, fn: () => T): T {
  return storage.run(transport, fn);
}

function isAsyncIterator(value: unknown): value is AsyncGenerator<unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as AsyncGenerator<unknown>).next === "function" &&
    typeof (value as AsyncGenerator<unknown>)[Symbol.asyncIterator] === "function"
  );
}

/**
 * Nesnenin her metodunu verilen taşımanın bağlamında çalıştırır. Üreteç
 * dönen metotlarda her `next()` adımı da sarılır (gövde `next` çağrısının
 * bağlamında ilerler — ajan sunucusundaki akış sarmalayıcısıyla aynı).
 */
export function bindDockerTransport<T extends object>(target: T, transport: DockerTransport): T {
  return new Proxy(target, {
    get(object, property, receiver) {
      const value = Reflect.get(object, property, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        // `this` sarmalanmış nesne: metot içi `this.pullImage(...)` da bağlı kalır.
        const result = runWithDockerTransport(transport, () => value.apply(receiver, args));
        if (!isAsyncIterator(result)) return result;
        const iterator = result;
        const wrapped: AsyncGenerator<unknown> = {
          next: (...a) => runWithDockerTransport(transport, () => iterator.next(...(a as []))),
          return: (v) => runWithDockerTransport(transport, () => iterator.return(v)),
          throw: (e) => runWithDockerTransport(transport, () => iterator.throw(e)),
          [Symbol.asyncIterator]() {
            return wrapped;
          },
          // Node 26: AsyncGenerator'da asyncDispose da tanımlı.
          [Symbol.asyncDispose]: async () => {
            await runWithDockerTransport(transport, () => iterator.return(undefined));
          },
        };
        return wrapped;
      };
    },
  });
}
