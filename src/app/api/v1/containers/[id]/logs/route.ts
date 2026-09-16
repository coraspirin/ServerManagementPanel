import { serverT } from "@/lib/i18n/runtime";
import { guardV1 } from "@/lib/apiv1/guard";
import { LIMITS, clampedNumber, optionalTimestamp } from "@/lib/apiv1/paginate";
import { apiError, apiText } from "@/lib/apiv1/respond";
import { getDockerProvider } from "@/lib/providers";

export const dynamic = "force-dynamic";

/**
 * Container logları — DÜZ METİN, AKIŞSIZ.
 *
 * İç uç (`/api/docker/[id]/logs`) SSE ile canlı akıyor çünkü tarayıcı bunu
 * gösterebiliyor. Bir script gösteremez: `curl` bir SSE akışına bağlanıp
 * beklemeye başlar ve `| grep` yazan kullanıcı hiçbir zaman komut istemine
 * dönmez. Burada tek parça gövde dönüyor ve bağlantı kapanıyor.
 *
 * SAYFALANMIYOR — bu bir kuyruk, bir koleksiyon değil. `tail` (son N satır)
 * ve `since` yeterli; imleç eklemek Docker'ın kendi log API'sinde karşılığı
 * olmayan bir soyutlama üretirdi.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardV1(request, "docker.view");
  if (!guard.ok) return guard.response;

  const id = (await params).id;
  const search = new URL(request.url).searchParams;
  const tail = clampedNumber(search.get("tail"), LIMITS.logsTail.fallback, 1, LIMITS.logsTail.max);
  const since = optionalTimestamp(search.get("since"));

  const provider = getDockerProvider();

  /*
   * Önce KANONİK id'ye çevir.
   *
   * `/api/v1/containers/{id}` adı da, id önekini de kabul ediyor; bu ucun
   * farklı davranması "aynı tanımlayıcı bir uçta çalışıyor, diğerinde
   * çalışmıyor" gibi açıklanamaz bir fark üretirdi. Ayrıca sağlayıcılar bu
   * konuda aynı davranmıyor: Docker'ın kendi API'si adı çözüyor, mock
   * yalnızca id ile eşleştiriyor. Çözümü buraya almak, farkı sağlayıcıdan
   * bağımsız olarak kapatıyor.
   */
  let summaries;
  try {
    summaries = await provider.list(true);
  } catch (error) {
    return apiError(
      "upstream_error",
      error instanceof Error ? error.message : serverT("api.docker.unreachable"),
    );
  }

  const target = summaries.find(
    (item) => item.id === id || item.name === id || item.id.startsWith(id),
  );
  if (!target) return apiError("not_found", serverT("api.notFound.container"));

  // `follow: false` ile üretici sonlu; yine de bir iptal sinyali ZORUNLU
  // (arayüz sözleşmesi) ve istemci bağlantıyı koparırsa akış boşuna
  // çalışmaya devam etmesin diye isteğinkine bağlanıyor.
  const controller = new AbortController();
  request.signal.addEventListener("abort", () => controller.abort());

  const lines: string[] = [];
  try {
    for await (const line of provider.logs(target.id, {
      tail,
      follow: false,
      signal: controller.signal,
      since,
    })) {
      lines.push(line.text);
      // Sağlayıcı `tail`e uymazsa (mock, ya da Docker'ın ters davranışı)
      // yanıtın sınırsız büyümesini engelleyen ikinci kapı.
      if (lines.length >= tail) break;
    }
  } catch (error) {
    return apiError(
      "upstream_error",
      error instanceof Error ? error.message : serverT("api.v1.logsUnreadable"),
    );
  } finally {
    controller.abort();
  }

  return apiText(lines.join("\n") + (lines.length > 0 ? "\n" : ""));
}
