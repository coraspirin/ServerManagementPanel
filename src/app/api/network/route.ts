import { serverT } from "@/lib/i18n/runtime";
import { enterHost, guardHostApi } from "@/lib/auth/api";
import { audit } from "@/lib/auth/audit";
import { ouiStatus, refreshOui } from "@/lib/network/oui";
import { deleteDevice, detectSubnet, listDevices, runScan, setDeviceKnown } from "@/lib/network/scan";
import { listWolDevices } from "@/lib/network/wol";

export const dynamic = "force-dynamic";

export async function networkPayload() {
  return {
    devices: listDevices(),
    wol: listWolDevices(),
    subnet: (await detectSubnet()) ?? "",
    oui: ouiStatus(),
  };
}

export async function GET(request: Request) {
  const guard = await guardHostApi(request, "network.manage", { localOnly: true });
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  return Response.json(await networkPayload());
}

export async function POST(request: Request) {
  const guard = await guardHostApi(request, "network.manage", { localOnly: true });
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: serverT("api.invalidRequest") }, { status: 400 });
  }

  const action = String(body.action ?? "");

  if (action === "scan") {
    // Elle tarama `network.scan_enabled` ayarına BAKMAZ: kullanıcı düğmeye
    // basarak zaten açık bir istekte bulundu. Ayar, arka planda kendiliğinden
    // çalışmayı yönetiyor.
    const result = await runScan();

    audit({
      userId: guard.session.user.id,
      username: guard.session.user.username,
      action: "network.scan",
      detail: serverT("api.network.scanSummary", { subnet: result.subnet || serverT("api.network.noSubnet"), alive: result.alive, fresh: result.newDevices.length }),
      result: "ok",
    });

    return Response.json({ ok: true, result, ...(await networkPayload()) });
  }

  if (action === "oui") {
    const result = await refreshOui(true);
    return Response.json({ ok: result.updated, message: result.message, ...(await networkPayload()) });
  }

  if (action === "known") {
    const mac = String(body.mac ?? "");
    setDeviceKnown(mac, body.known !== false, String(body.label ?? ""));
    return Response.json({ ok: true, ...(await networkPayload()) });
  }

  return Response.json({ error: serverT("api.unknownAction") }, { status: 400 });
}

export async function DELETE(request: Request) {
  const guard = await guardHostApi(request, "network.manage", { localOnly: true });
  if (!guard.ok) return guard.response;
  enterHost(guard.hostId);

  const mac = new URL(request.url).searchParams.get("mac") ?? "";
  deleteDevice(mac);

  audit({
    userId: guard.session.user.id,
    username: guard.session.user.username,
    action: "network.device.delete",
    targetId: mac,
    result: "ok",
  });

  return Response.json({ ok: true, ...(await networkPayload()) });
}
