import { serverT } from "@/lib/i18n/runtime";
import { appVersion, isMockMode } from "@/lib/env";
import { getSystemProvider } from "@/lib/providers";
import { dbStatus } from "@/lib/db/status";

export const dynamic = "force-dynamic";

/**
 * Deploy hattının ve container sağlığının doğrulama noktası (M0.1).
 * docker-compose healthcheck'i M0.2'de buraya bağlanacak.
 */
export async function GET() {
  const startedAt = performance.now();

  try {
    const system = await getSystemProvider().info();
    const db = dbStatus();

    return Response.json({
      status: db.integrityOk ? "ok" : "degraded",
      version: appVersion(),
      mode: isMockMode() ? "mock" : "live",
      time: new Date().toISOString(),
      responseMs: Math.round(performance.now() - startedAt),
      system: {
        hostname: system.hostname,
        platform: system.platform,
        uptimeSeconds: system.uptimeSeconds,
      },
      db,
    });
  } catch (error) {
    return Response.json(
      {
        status: "error",
        version: appVersion(),
        mode: isMockMode() ? "mock" : "live",
        time: new Date().toISOString(),
        message: error instanceof Error ? error.message : serverT("api.unknownError"),
      },
      { status: 503 },
    );
  }
}
