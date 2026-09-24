import { serverT } from "@/lib/i18n/runtime";
import { enterHost, guardHostApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import {
  callHelper,
  helperConfigured,
  parseShow,
  parseUnitList,
  type HelperAction,
} from "@/lib/host/helper";
import type { PermissionKey } from "@/lib/auth/types";

export const dynamic = "force-dynamic";

/**
 * Host işlemleri — güç ve systemd (M1.13).
 *
 * Panel burada hiçbir şey ÇALIŞTIRMAZ; host'taki helper'a rica eder. İki
 * bağımsız kapı var ve ikisi de gerekli:
 *   1. Panel tarafı: RBAC izni (`host.power` / `host.service`)
 *   2. Host tarafı: `/etc/panel-helper/allow.conf` — container'ın göremediği
 *      ve değiştiremediği liste
 *
 * Panel ele geçirilse bile ikincisi durur. Bu yüzden buradaki izin kontrolü
 * "güvenlik" değil "kullanıcı deneyimi": yetkisiz kullanıcıya düğmeyi hiç
 * göstermemek için.
 */
const PERMISSION: Record<string, PermissionKey> = {
  "power.reboot": "host.power",
  "power.shutdown": "host.power",
  "power.cancel": "host.power",
  "service.status": "host.service",
  "service.list": "host.service",
  "service.restart": "host.service",
  "service.start": "host.service",
  "service.stop": "host.service",
};

export async function POST(request: Request) {
  let body: { action?: unknown; args?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const action = String(body.action ?? "") as HelperAction;
  const permission = PERMISSION[action];
  if (!permission) return Response.json({ error: serverT("api.invalidAction") }, { status: 400 });

  const guard = await guardHostApi(request, permission);
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  if (!helperConfigured()) {
    return Response.json(
      {
        error:
          serverT("apiv1.helperMissing"),
      },
      { status: 503 },
    );
  }

  const args = (body.args ?? {}) as Record<string, unknown>;
  const user = guard.session.user;

  const response = await callHelper(action, args, {
    username: user.username,
    userId: user.id,
  });

  audit({
    userId: user.id,
    username: user.username,
    action: `host.${action}`,
    targetType: "host",
    targetId: String(args.unit ?? ""),
    detail: response.ok
      ? (response.stdout ?? "").slice(0, 200)
      : (response.error ?? response.stderr ?? "").slice(0, 200),
    result: response.ok ? "ok" : "error",
  });

  if (!response.ok) {
    return Response.json(
      { error: response.error ?? response.stderr ?? "host-helper reddetti" },
      { status: 502 },
    );
  }

  // Ham çıktıyı istemciye taşımak yerine burada çözülüyor: aynı ayrıştırmayı
  // hem sunucuda hem tarayıcıda yazmak, ikisinin ayrışmasıyla biterdi.
  if (action === "service.list") {
    return Response.json({ ok: true, units: parseUnitList(response.stdout ?? "") });
  }
  if (action === "service.status") {
    return Response.json({ ok: true, unit: parseShow(response.stdout ?? "") });
  }

  return Response.json({ ok: true, output: response.stdout ?? "" });
}
