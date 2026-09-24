import { enterHost, guardHostApi } from "@/lib/auth/api";
import { dockerOverview } from "@/lib/docker/view";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await guardHostApi(request, "docker.view");
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  return Response.json(await dockerOverview());
}
