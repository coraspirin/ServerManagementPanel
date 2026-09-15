import { guardApi } from "@/lib/auth/api";
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
  const guard = await guardApi(request, "security.view");
  if (!guard.ok) return guard.response;

  return Response.json({ firewall: await firewallState() });
}
