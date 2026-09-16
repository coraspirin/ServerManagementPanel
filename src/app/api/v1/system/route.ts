import { serverT } from "@/lib/i18n/runtime";
import { guardV1 } from "@/lib/apiv1/guard";
import { apiError, apiOk } from "@/lib/apiv1/respond";
import { serializeSystem } from "@/lib/apiv1/serialize";
import { latestSnapshot } from "@/lib/metrics/collect";
import { getSystemProvider } from "@/lib/providers";

export const dynamic = "force-dynamic";

/** Sistem bilgisi + son metrik anlık görüntüsü. */
export async function GET(request: Request) {
  const guard = await guardV1(request, "metrics.view");
  if (!guard.ok) return guard.response;

  try {
    const [info, snapshot] = await Promise.all([
      getSystemProvider().info(),
      Promise.resolve(latestSnapshot()),
    ]);
    return apiOk(serializeSystem(info, snapshot));
  } catch (error) {
    // Mesaj `error.message` üzerinden geçiyor: insan için yazılmış metin,
    // içinde başlık ya da ham gövde yok (§Loglama).
    return apiError(
      "upstream_error",
      error instanceof Error ? error.message : serverT("api.v1.systemUnreadable"),
    );
  }
}
