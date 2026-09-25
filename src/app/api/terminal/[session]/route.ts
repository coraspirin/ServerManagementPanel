import { serverT } from "@/lib/i18n/runtime";
import { enterHost, guardHostApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import {
  closeSession,
  exitCodeOf,
  getSession,
  readOutput,
  resizeSession,
  writeInput,
} from "@/lib/docker/exec";

export const dynamic = "force-dynamic";

/**
 * Terminal oturumunun çıkış ucu — SSE (M1.9).
 *
 * Giriş ayrı bir POST ile geliyor (bkz. `PATCH`/`POST` altta). Bölünmenin
 * sebebi `lib/docker/exec.ts`'te yazılı: Route Handler'lar WebSocket
 * yükseltmesi yapamıyor.
 */
export async function GET(request: Request, { params }: { params: Promise<{ session: string }> }) {
  const guard = await guardHostApi(request, "docker.exec", { agent: true });
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  const session = getSession((await params).session, guard.session.user.username);
  if (!session) return Response.json({ error: serverT("api.notFound.session") }, { status: 404 });

  const encoder = new TextEncoder();
  const signal = request.signal;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      try {
        for await (const chunk of readOutput(session, signal)) {
          if (signal.aborted) break;
          send("out", chunk);
        }
        if (!signal.aborted) send("bitti", { exitCode: await exitCodeOf(session) });
      } catch (error) {
        if (!signal.aborted) {
          send("hata", {
            message: error instanceof Error ? error.message : serverT("api.terminal.streamLost"),
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
      "x-accel-buffering": "no",
    },
  });
}

/** Giriş ucu: tuş vuruşları ve pencere boyutu. */
export async function POST(request: Request, { params }: { params: Promise<{ session: string }> }) {
  const guard = await guardHostApi(request, "docker.exec", { agent: true });
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  const session = getSession((await params).session, guard.session.user.username);
  if (!session) return Response.json({ error: serverT("api.notFound.session") }, { status: 404 });
  if (session.closed) {
    // Kabuk kapandıysa tuş vuruşunu sessizce yutmak yerine söylemek gerekir:
    // istemci "yazıyorum ama bir şey olmuyor" haline düşmesin.
    return Response.json({ error: serverT("api.terminal.closed") }, { status: 409 });
  }

  let body: { data?: unknown; cols?: unknown; rows?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  if (typeof body.data === "string") writeInput(session, body.data);

  if (typeof body.cols === "number" && typeof body.rows === "number") {
    await resizeSession(session.id, body.cols, body.rows);
  }

  return Response.json({ ok: true });
}

/** Kullanıcı pencereyi kapattığında kabuk da kapansın. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ session: string }> },
) {
  const guard = await guardHostApi(request, "docker.exec", { agent: true });
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  const id = (await params).session;
  const session = getSession(id, guard.session.user.username);
  if (!session) return Response.json({ ok: true });

  closeSession(id);
  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "docker.exec_close",
    targetType: "container",
    targetId: session.containerName,
    result: "ok",
  });

  return Response.json({ ok: true });
}
