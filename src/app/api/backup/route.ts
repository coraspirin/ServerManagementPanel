import { backupGuard } from "@/lib/backup/http";
import { backupOverview } from "@/lib/backup/overview";

export const dynamic = "force-dynamic";

/** Yedekleme genel bakışı: üç sistemin durumu, özel işler, konumlar, canlı koşular. */
export async function GET(request: Request) {
  const guard = await backupGuard(request);
  if (!guard.ok) return guard.response;
  return Response.json(backupOverview());
}
