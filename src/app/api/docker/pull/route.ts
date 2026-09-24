import { serverT } from "@/lib/i18n/runtime";
import { enterHost, guardHostApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { getDockerProvider } from "@/lib/providers";
import { isMockMode } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Serbest image çekme (M3.46).
 *
 * ## Neden yeni bir uç gerekti
 *
 * Panelde pull üç yerde vardı ve üçü de BİR ŞEYE BAĞLIYDI: var olan bir
 * container'ın imajını güncellemek, bir compose yığınını çekmek, ya da
 * eksik imajı sessizce indirmek. "Şu imajı çek" diyebilmenin yolu yoktu —
 * oysa container oluşturmanın ilk adımı tam olarak bu.
 *
 * ## Neden SSE
 *
 * Home Assistant imajı 3 GB; toptan beklenen bir yanıt hem zaman aşımına
 * yakalanır hem de kullanıcıya "dondu mu?" dedirtir. Aynı desen tek-tık
 * güncellemede (`[id]/update`) zaten kullanılıyor ve olay adları da aynı
 * tutuldu (`adim` / `bitti` / `hata`) — iki ayrı akış sözleşmesi öğretmenin
 * anlamı yok.
 *
 * `EventSource` yalnızca GET yapabildiği için istemci yanıt gövdesini
 * kendisi okuyor.
 */
export async function POST(request: Request) {
  const guard = await guardHostApi(request, "docker.action");
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  if (isMockMode()) {
    return Response.json(
      { error: serverT("api.mock.pull") },
      { status: 503 },
    );
  }

  let reference = "";
  try {
    reference = String(((await request.json()) as { reference?: unknown }).reference ?? "").trim();
  } catch {
    return Response.json({ error: serverT("common.errors.invalidBody") }, { status: 400 });
  }

  // Boşluk ve kabuk karakterleri bir image referansında yeri olmayan şeyler;
  // erken reddetmek, Docker'ın anlaşılmaz hatasından daha yardımcı.
  if (!reference || /[\s"'`$;|&<>]/.test(reference)) {
    return Response.json(
      { error: serverT("api.docker.imageName") },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  const user = guard.session.user;
  const provider = getDockerProvider();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      try {
        for await (const line of provider.pullImage(reference)) send("adim", line);

        /*
          Çekilen imajın kendi yapılandırması da gönderiliyor: istemci
          container formunu bununla dolduruyor (açık portlar, ortam
          değişkenleri, volume'ler). Ayrı bir istek attırmak, kullanıcının
          pull bittikten sonra bir tur daha beklemesi demekti.
        */
        const inspect = await provider.inspectImageRaw(reference).catch(() => null);

        audit({
          userId: user.id,
          username: user.username,
          action: "docker.image_pull",
          targetType: "image",
          targetId: reference,
          detail: serverT("api.docker.pulled"),
          result: "ok",
        });

        send("bitti", { reference, inspect });
      } catch (error) {
        const message = error instanceof Error ? error.message : serverT("api.docker.pullFailed");

        audit({
          userId: user.id,
          username: user.username,
          action: "docker.image_pull",
          targetType: "image",
          targetId: reference,
          detail: message,
          result: "error",
        });

        send("hata", { message });
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
      "x-accel-buffering": "no",
    },
  });
}
