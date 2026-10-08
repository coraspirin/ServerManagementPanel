import { backupGuard } from "@/lib/backup/http";
import { liveRuns } from "@/lib/backup/live";

export const dynamic = "force-dynamic";

/**
 * Canlı ilerleme (SSE). Sunucudaki tüm çalışan/yeni bitmiş koşular saniyede
 * bir gönderilir; liste değişmediyse yalnızca kalp atışı. Tek akış, ekrandaki
 * tüm ilerleme çubuklarını besler.
 */
export async function GET(request: Request) {
  const guard = await backupGuard(request);
  if (!guard.ok) return guard.response;
  const hostId = guard.hostId;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let last = "";
      let beats = 0;
      const tick = () => {
        try {
          const payload = JSON.stringify(liveRuns(hostId));
          if (payload !== last) {
            last = payload;
            controller.enqueue(encoder.encode(`event: runs\ndata: ${payload}\n\n`));
          } else if (++beats % 15 === 0) {
            controller.enqueue(encoder.encode(": ping\n\n"));
          }
        } catch {
          stop();
        }
      };
      const timer = setInterval(tick, 1000);
      const stop = () => {
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          // Zaten kapalı.
        }
      };
      request.signal.addEventListener("abort", stop, { once: true });
      tick();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
