import { serverT } from "@/lib/i18n/runtime";
import { enterHost, guardHostApi } from "@/lib/auth/api";
import { getDockerProvider } from "@/lib/providers";
import { getNumber } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Canlı container logu — Server-Sent Events (M1.7).
 *
 * SSE seçildi, WebSocket değil: akış tek yönlü (sunucudan tarayıcıya), tarayıcı
 * `EventSource` ile kopan bağlantıyı kendiliğinden yeniden kuruyor ve normal
 * HTTP olduğu için Caddy'nin arkasında ek yapılandırma gerekmiyor. WebSocket
 * yalnızca web terminalde (M1.9) gerekli olacak — orada iki yönlü akış var.
 *
 * İstemci sekmeyi kapattığında `request.signal` iptal olur ve Docker soketine
 * açılan akış kapanır; aksi halde her açılan log penceresi kalıcı bir bağlantı
 * bırakırdı.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardHostApi(request, "docker.view");
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  const id = (await params).id;
  const url = new URL(request.url);
  const tail = Math.min(
    Math.max(Number(url.searchParams.get("tail") ?? getNumber("docker.log_tail_lines")), 10),
    5000,
  );

  const encoder = new TextEncoder();
  const controllerSignal = request.signal;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        for await (const line of getDockerProvider().logs(id, {
          tail,
          follow: true,
          signal: controllerSignal,
        })) {
          if (controllerSignal.aborted) break;
          send("log", line);
        }
      } catch (error) {
        if (!controllerSignal.aborted) {
          send("hata", {
            message: error instanceof Error ? error.message : serverT("api.docker.logStreamLost"),
          });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Akış zaten kapanmış olabilir.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Caddy/nginx ara belleklemesi canlı akışı geciktirmesin.
      "x-accel-buffering": "no",
    },
  });
}
