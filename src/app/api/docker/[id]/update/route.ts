import { serverT } from "@/lib/i18n/runtime";
import { enterHost, guardHostApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { updateContainerImage } from "@/lib/docker/update";
import { refreshImageUpdates } from "@/lib/updates";
import { isMockMode } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Tek-tık image güncellemesi — ilerleme SSE ile (M1.11).
 *
 * `POST` kullanılıyor ama yanıt bir akış: pull dakikalar sürebilir ve
 * kullanıcı "dondu mu?" diye bakmamalı. `EventSource` yalnızca GET yapabildiği
 * için istemci yanıt gövdesini kendisi okuyor.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardHostApi(request, "docker.action", { agent: true });
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  if (isMockMode()) {
    return Response.json(
      { error: serverT("api.mock.update") },
      { status: 503 },
    );
  }

  const id = (await params).id;
  const encoder = new TextEncoder();
  const user = guard.session.user;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      try {
        const result = await updateContainerImage(id, (step) => send("adim", step));

        audit({
          userId: user.id,
          username: user.username,
          action: "docker.image_update",
          targetType: "container",
          targetId: result.container,
          // Eski image kimliği geri alma için tek ipucu: kullanıcı isterse
          // `docker tag <id> repo:etiket` ile önceki sürüme dönebilir.
          detail: result.blockedBy
            ? serverT("api.docker.gateBlocked", { by: result.blockedBy })
            : result.changed
              ? serverT("api.docker.updated", { old: result.oldImageId.slice(7, 19), new: result.newImageId.slice(7, 19) })
              : serverT("api.docker.upToDate"),
          // Engellenen güncelleme bir hata değil ama "ok" da değil: istenen
          // şey yapılmadı ve denetim kaydı bunu ayırt edebilmeli (M3.28).
          result: result.blockedBy ? "error" : "ok",
        });

        send("bitti", result);
      } catch (error) {
        const message = error instanceof Error ? error.message : serverT("api.docker.updateFailed");
        audit({
          userId: user.id,
          username: user.username,
          action: "docker.image_update",
          targetType: "container",
          targetId: id,
          detail: message,
          result: "error",
        });
        send("hata", { message });
      } finally {
        // Güncelleme sonrası liste bayat kalmasın.
        await refreshImageUpdates().catch(() => {});
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
      "x-accel-buffering": "no",
    },
  });
}
