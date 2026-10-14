import "server-only";

import { agentCall, agentStream } from "@/lib/agent/client";
import {
  DOCKER_API_OP,
  DOCKER_API_STREAM_OP,
  type DockerApiRequest,
  type DockerApiResponse,
  type DockerApiStreamHead,
} from "@/lib/agent/protocol";
import type { Host } from "@/lib/hosts/types";
import { getString } from "@/lib/settings";
import type { DockerRequest, DockerStreamReply, DockerTransport } from "./transport";

/**
 * Uzak sunucunun Docker'ı — ajanın `docker.api` tüneli üzerinden ham Engine
 * API (kararlar.md K2). Şekillendirme merkezde (`docker.live.ts`), ajan
 * yalnızca izinli istekleri iletir (`agent/docker-api-policy.ts`).
 */

/** Tünelin RPC payı: ajan Docker'ı bekledikten sonra yanıt yolda kaybolmasın. */
const RPC_MARGIN_MS = 15_000;
/** Süresi verilmemiş istekte RPC'nin sınırı (ajan Docker'a 6 sa tanır). */
const UNBOUNDED_RPC_MS = 6 * 60 * 60 * 1000 + RPC_MARGIN_MS;

function wire(request: DockerRequest): DockerApiRequest {
  return {
    method: request.method ?? "GET",
    path: request.path,
    ...(request.headers ? { headers: request.headers } : {}),
    ...(request.body === undefined
      ? {}
      : { body: Buffer.isBuffer(request.body) ? request.body : Buffer.from(request.body) }),
    ...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {}),
  };
}

export function remoteDockerTransport(host: Host): DockerTransport {
  return {
    kind: "remote",
    async request(request) {
      const reply = await agentCall<DockerApiResponse>(host, DOCKER_API_OP, [wire(request)], {
        timeoutMs: request.timeoutMs ? request.timeoutMs + RPC_MARGIN_MS : UNBOUNDED_RPC_MS,
      });
      return { status: reply.status, headers: reply.headers ?? {}, body: reply.body ?? Buffer.alloc(0) };
    },

    async stream(request): Promise<DockerStreamReply> {
      // `close()` ve çağıranın sinyali aynı bağlantıyı kapatır.
      const abort = new AbortController();
      request.signal?.addEventListener("abort", () => abort.abort(), { once: true });
      const frames = agentStream<DockerApiStreamHead | Buffer>(
        host,
        DOCKER_API_STREAM_OP,
        [wire({ ...request, timeoutMs: undefined })],
        abort.signal,
      );

      const first = await frames.next();
      if (first.done || Buffer.isBuffer(first.value)) {
        abort.abort();
        throw new Error("docker-api-stream: missing head"); // i18n-ignore — protokol hatası
      }
      const head = first.value;

      async function* body(): AsyncGenerator<Buffer> {
        try {
          for await (const frame of frames) {
            if (Buffer.isBuffer(frame)) yield frame;
          }
        } finally {
          abort.abort();
        }
      }

      return {
        status: head.status,
        headers: head.headers ?? {},
        body: body(),
        close: () => abort.abort(),
      };
    },
  };
}

/**
 * Uzak sunucunun Docker'ına hangi yolla gidilir:
 *  - `rpc`: ajandaki sağlayıcı (`docker.list`… `DOCKER_CALLS`) — Node ajanı
 *  - `api`: ham Engine API tüneli, şekillendirme merkezde
 *
 * Native ajan sağlayıcı RPC'si sunmaz (`dockerRpc: false`) → her zaman api.
 * Node ajanında ikisi de var; varsayılan rpc (davranış değişmez), sunucuya
 * özel `agents.docker_transport = api` ile tünel denenebilir. Tüneli
 * tanımayan eski ajan her durumda rpc.
 */
export function remoteDockerMode(host: Host): "api" | "rpc" {
  const caps = host.capabilities;
  if (caps.dockerRpc === false) return "api";
  if (caps.dockerApi !== true) return "rpc";
  const choice = getString("agents.docker_transport", { type: "host", id: String(host.id) });
  return choice === "api" ? "api" : "rpc";
}
