import { guardApi } from "@/lib/auth/api";
import { latestSnapshot } from "@/lib/metrics/collect";
import { getSystemProvider } from "@/lib/providers";

export const dynamic = "force-dynamic";

/** Anlık sistem durumu — İzleme ekranındaki kartları besler (M1.1). */
export async function GET(request: Request) {
  const guard = await guardApi(request, "metrics.view");
  if (!guard.ok) return guard.response;

  const [system, snapshot] = await Promise.all([
    getSystemProvider().info(),
    Promise.resolve(latestSnapshot()),
  ]);

  return Response.json({ system, snapshot });
}
