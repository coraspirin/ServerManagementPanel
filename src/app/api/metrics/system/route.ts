import { enterHost, guardHostApi } from "@/lib/auth/api";
import { latestSnapshot } from "@/lib/metrics/collect";
import { getSystemProvider } from "@/lib/providers";

export const dynamic = "force-dynamic";

/** Anlık sistem durumu — İzleme ekranındaki kartları besler (M1.1). */
export async function GET(request: Request) {
  const guard = await guardHostApi(request, "metrics.view", { agent: true });
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  const [system, snapshot] = await Promise.all([
    getSystemProvider().info(),
    Promise.resolve(latestSnapshot()),
  ]);

  return Response.json({ system, snapshot });
}
