import { enterHost, guardHostApi } from "@/lib/auth/api";
import { firewallState } from "@/lib/security/firewall";

export const dynamic = "force-dynamic";

/**
 * Güvenlik ekranının okuma ucu.
 *
 * Güvenlik duvarı YAZMA uçları M3.18'de `/api/firewall`e taşındı; port
 * envanteri M3.17'de `/api/ports`a. Burada kalan tek şey, eski ekranların
 * kırılmaması için duran firewall okuması.
 */
export async function GET(request: Request) {
  const guard = await guardHostApi(request, "security.view", { localOnly: true });
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  return Response.json({ firewall: await firewallState() });
}
