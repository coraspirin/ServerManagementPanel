import { guardApi } from "@/lib/auth/api";
import { dockerOverview } from "@/lib/docker/view";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await guardApi(request, "docker.view");
  if (!guard.ok) return guard.response;

  return Response.json(await dockerOverview());
}
