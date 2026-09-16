import { serverT } from "@/lib/i18n/runtime";
import { guardV1 } from "@/lib/apiv1/guard";
import { apiError, apiOk } from "@/lib/apiv1/respond";
import { serializeContainer } from "@/lib/apiv1/serialize";
import { dockerOverview } from "@/lib/docker/view";

export const dynamic = "force-dynamic";

/**
 * Tek container.
 *
 * İç detay ucundan (`/api/docker/[id]/detail`) farklı olarak ham `inspect`
 * çıktısını, bağımlılık grafiğini ve runbook'u DÖNDÜRMÜYOR. Ham inspect,
 * Docker'ın kendi sürüm sürüm değişen şeması demek; onu v1 sözleşmesine
 * koymak, kararlılık sözünü Docker'ın insafına bırakmak olurdu. İhtiyacı olan
 * istemci zaten Docker soketine kendi bakabilir.
 *
 * `id` container adı da olabilir: liste zaten elde ve ada göre eşleştirmek
 * ikinci bir Docker çağrısından ucuz.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardV1(request, "docker.view");
  if (!guard.ok) return guard.response;

  const id = (await params).id;
  const overview = await dockerOverview();

  if (overview.error !== null) return apiError("upstream_error", overview.error);

  const found = overview.containers.find(
    (container) => container.id === id || container.name === id || container.id.startsWith(id),
  );
  if (!found) return apiError("not_found", serverT("api.notFound.container"));

  return apiOk({ measuredAt: overview.statsAt, container: serializeContainer(found) });
}
