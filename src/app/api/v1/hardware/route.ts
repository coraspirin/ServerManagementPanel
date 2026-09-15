import { guardV1 } from "@/lib/apiv1/guard";
import { apiError, apiOk } from "@/lib/apiv1/respond";
import { serializeHardware } from "@/lib/apiv1/serialize";
import { getHardwareProvider } from "@/lib/providers";

export const dynamic = "force-dynamic";

/** Sıcaklıklar, S.M.A.R.T ve RAID/ZFS havuzları. */
export async function GET(request: Request) {
  const guard = await guardV1(request, "metrics.view");
  if (!guard.ok) return guard.response;

  try {
    return apiOk(serializeHardware(await getHardwareProvider().report()));
  } catch (error) {
    return apiError(
      "upstream_error",
      error instanceof Error ? error.message : "donanım raporu okunamadı",
    );
  }
}
