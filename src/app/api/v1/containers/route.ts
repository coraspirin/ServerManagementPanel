import { guardV1 } from "@/lib/apiv1/guard";
import { apiError, apiOk } from "@/lib/apiv1/respond";
import { serializeContainer } from "@/lib/apiv1/serialize";
import { dockerOverview } from "@/lib/docker/view";

export const dynamic = "force-dynamic";

/** Container listesi + son ölçümler. */
export async function GET(request: Request) {
  const guard = await guardV1(request, "docker.view");
  if (!guard.ok) return guard.response;

  const overview = await dockerOverview();

  // `dockerOverview` Docker'a erişilemediğinde fırlatmıyor, `error` alanıyla
  // dönüyor — ekran kısmi veri gösterebilsin diye. v1'de bu bir başarı
  // yanıtı olamaz: boş bir dizi "hiç container yok" demektir ve bunu okuyan
  // bir otomasyon yanlış karar verir.
  if (overview.error !== null) {
    return apiError("upstream_error", overview.error);
  }

  return apiOk({
    hostId: 1,
    measuredAt: overview.statsAt,
    containers: overview.containers.map((container) => serializeContainer(container)),
  });
}
