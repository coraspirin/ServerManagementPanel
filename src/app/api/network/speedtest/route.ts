import { enterHost, guardHostApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { listSpeedtests, runSpeedtest } from "@/lib/network/speedtest";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await guardHostApi(request, "network.manage", { localOnly: true });
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  return Response.json({ results: listSpeedtests() });
}

/**
 * Elle hız testi.
 *
 * Uzun sürer ve BİLEREK öyle: ölçüm sabit süreli (her yön için ısınma + ölçüm
 * penceresi), çünkü sabit bayt indirmek hızlı hatta anında bitip anlamsız bir
 * sayı üretiyordu. Arayüz beklemeye hazır olmalı ve kullanıcıya söylemeli.
 */
export async function POST(request: Request) {
  const guard = await guardHostApi(request, "network.manage", { localOnly: true });
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  const result = await runSpeedtest();

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "speedtest.run",
    detail: result.ok
      ? `${result.downloadMbps} / ${result.uploadMbps} Mbit · ${result.pingMs} ms`
      : result.error,
    result: result.ok ? "ok" : "error",
  });

  return Response.json({ ok: result.ok, result, results: listSpeedtests() });
}
